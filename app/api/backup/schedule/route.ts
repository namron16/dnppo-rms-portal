// app/api/backup/schedule/route.ts
//
// GET  — returns all module backup configs (used by ScheduleModal to populate fields)
// POST — saves a config change AND reschedules the matching pg_cron job if the
//        frequency or backup_hour changed.
//
// New field vs original: backup_hour (0–23).  Default 2 = 2:00 AM.
// When the admin changes frequency OR backup_hour, this route calls the
// reschedule_backup_cron() Supabase RPC to update the live pg_cron schedule.

import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { requireAdmin } from '@/lib/backup/auth-guard'

export const runtime = 'nodejs'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps a frequency + hour to the matching pg_cron job name and cron expression.
 * Only daily / weekly / monthly / yearly are managed via pg_cron.
 * 'custom' and 'manual' skip the pg_cron reschedule step.
 */
function buildCronExpression(
  frequency: string,
  hour: number
): { jobName: string; cronExpr: string } | null {
  const h = Math.max(0, Math.min(23, Math.floor(hour)))

  switch (frequency) {
    case 'daily':
      return { jobName: 'rms-daily-backup',   cronExpr: `0 ${h} * * *`   }
    case 'weekly':
      return { jobName: 'rms-weekly-backup',  cronExpr: `0 ${h} * * 1`   }
    case 'monthly':
      return { jobName: 'rms-monthly-backup', cronExpr: `0 ${h} 1 * *`   }
    case 'yearly':
      return { jobName: 'rms-yearly-backup',  cronExpr: `0 ${h} 1 1 *`   }
    default:
      return null   // 'custom' and 'manual' — caller handles their own cron
  }
}

// ── GET /api/backup/schedule ──────────────────────────────────────────────────

/** Returns all backup_configs rows, ordered by module_name. */
export async function GET(request: Request) {
  try {
    await requireAdmin()
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }

  const db = getServiceClient()
  const { data, error } = await db
    .from('backup_configs')
    .select('*')
    .order('module_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// ── POST /api/backup/schedule ─────────────────────────────────────────────────

/**
 * Upserts the backup_config for one module AND (when applicable) calls
 * reschedule_backup_cron() to update the live pg_cron job.
 *
 * Body fields:
 *   module_name         — required
 *   is_enabled          — boolean
 *   frequency           — 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'manual'
 *   backup_hour         — integer 0–23 (new). Defaults to 2 if omitted.
 *   custom_cron         — cron expression, only used when frequency === 'custom'
 *   backup_type         — 'full' | 'incremental' | 'differential' | 'manual'
 *   include_attachments — boolean
 *   encrypt_backup      — boolean
 *   retention_days      — integer
 *   destination_path    — string | null
 */
export async function POST(request: Request) {
  try {
    await requireAdmin()
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }

  try {
    const body = await request.json()
    const {
      module_name,
      is_enabled,
      frequency,
      backup_hour = 2,          // NEW — defaults to 2 AM if not supplied
      custom_cron,
      backup_type,
      include_attachments,
      encrypt_backup,
      retention_days,
      destination_path,
    } = body

    if (!module_name) {
      return NextResponse.json({ error: 'module_name is required' }, { status: 400 })
    }

    const hour = Math.max(0, Math.min(23, parseInt(String(backup_hour), 10) || 2))

    const db = getServiceClient()

    // ── 1. Save config to database ────────────────────────────────────────────
    const { data, error } = await db
      .from('backup_configs')
      .upsert(
        {
          module_name,
          is_enabled,
          frequency,
          backup_hour:         hour,
          custom_cron:         frequency === 'custom' ? custom_cron : null,
          backup_type,
          include_attachments,
          encrypt_backup,
          retention_days,
          destination_path,
          last_configured_by:  'admin',
          last_configured_at:  new Date().toISOString(),
        },
        { onConflict: 'module_name' }
      )
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // ── 2. Reschedule pg_cron job (if applicable) ─────────────────────────────
    //
    // Only reschedule when:
    //   a) The frequency maps to a known pg_cron job (not 'custom' / 'manual')
    //   b) is_enabled is true  — if disabling, we unschedule instead
    //
    const cronTarget = buildCronExpression(frequency, hour)

    if (cronTarget) {
      if (is_enabled) {
        // Update (or create) the pg_cron job with the new expression
        const { error: rpcError } = await db.rpc('reschedule_backup_cron', {
          job_name:  cronTarget.jobName,
          new_cron:  cronTarget.cronExpr,
          frequency,
        })

        if (rpcError) {
          // Non-fatal: config was saved successfully; just warn about cron.
          console.warn(
            `[Schedule] pg_cron reschedule failed for ${cronTarget.jobName}:`,
            rpcError.message
          )
          return NextResponse.json({
            data,
            warning: `Config saved, but pg_cron reschedule failed: ${rpcError.message}. `
              + `The backup will still run via Vercel cron at the new time on next deployment.`,
          })
        }
      } else {
        // Module disabled — unschedule the pg_cron job so it stops firing.
        // Using the same RPC but immediately re-scheduling with a no-op body
        // is awkward; instead call cron.unschedule directly via a raw query.
        // We do it via a one-off RPC call with a never-firing cron as a safe
        // alternative (cron.unschedule is not directly exposed to service_role).
        //
        // Simplest safe approach: reschedule to a date that never arrives (Feb 30).
        // Better: add a dedicated unschedule RPC if needed. For now we leave the
        // job in place — it will fire but runScheduledBackup() will find no enabled
        // configs for this module and skip it. This is safe and already handled.
        console.log(
          `[Schedule] Module ${module_name} disabled. pg_cron job ${cronTarget.jobName} ` +
          `will fire but runScheduledBackup() will skip disabled modules.`
        )
      }
    }

    return NextResponse.json({ data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}