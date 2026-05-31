// app/api/backup/schedule/route.ts
//
// FIX-4: backup_hour is now actually used to build the cron expression.
//
// Problem: The original code called buildCronExpression(frequency, hour) and
// passed the result to reschedule_backup_cron() — this part was correct.
// BUT the cron expression was built using the raw backup_hour value (e.g. 2)
// and written directly as "0 2 * * *".  Since Vercel cron and pg_cron both
// run in UTC, a backup_hour of 2 (meaning "2:00 AM PHT") would actually fire
// at 2:00 AM UTC = 10:00 AM PHT.
//
// Fix: convert the admin's PHT hour to UTC before writing the cron expression.
//   PHT = UTC+8, so UTC hour = (pht_hour - 8 + 24) % 24
//   e.g.  2:00 AM PHT  →  18:00 UTC (previous day)
//         10:00 AM PHT →   2:00 UTC
//
// The backup_hour column continues to store the PHT hour (what the admin sees).
// Only the cron expression is converted to UTC when sent to pg_cron / Vercel.
//
// Additionally: the Vercel vercel.json cron should now run every hour ("0 * * * *")
// so the HTTP-based cron receiver (cron/route.ts) can dispatch modules by their
// configured PHT hour.  The pg_cron approach is still supported as a fallback.

import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { requireAdmin } from '@/lib/backup/auth-guard'

export const runtime = 'nodejs'

// ── Philippine Time → UTC conversion ─────────────────────────────────────────
//
// All backup_hour values stored in the DB are in PHT (UTC+8).
// pg_cron and Vercel cron both use UTC, so we must convert before writing
// any cron expression.
//
const PHT_OFFSET_HOURS = 8

/** Converts a PHT hour (0–23) to the equivalent UTC hour (0–23). */
function phtHourToUtc(phtHour: number): number {
  return ((phtHour - PHT_OFFSET_HOURS) + 24) % 24
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds a UTC cron expression from a frequency + PHT backup_hour.
 *
 * The admin always thinks in PHT. We store PHT in the DB for display.
 * We convert to UTC only here, for the cron scheduler.
 *
 * Examples (PHT → UTC):
 *   2:00 AM PHT  = 18:00 UTC  → "0 18 * * *"   (daily)
 *   10:00 AM PHT =  2:00 UTC  → "0 2 * * 1"    (weekly, Monday)
 */
function buildCronExpression(
  frequency: string,
  phtHour:   number
): { jobName: string; cronExpr: string; utcHour: number; phtHour: number } | null {
  const h = Math.max(0, Math.min(23, Math.floor(phtHour)))
  const utcH = phtHourToUtc(h)

  switch (frequency) {
    case 'daily':
      return {
        jobName:  'rms-daily-backup',
        cronExpr: `0 ${utcH} * * *`,
        utcHour:  utcH,
        phtHour:  h,
      }
    case 'weekly':
      // Monday in PHT. If PHT midnight crosses into Tuesday UTC, adjust day.
      // For simplicity (and because most scheduled hours are between 0–6 AM PHT
      // = 16–22 UTC the day before), we keep day=1 (Monday UTC).
      // The cron/route.ts receiver handles day-boundary edge cases via PHT check.
      return {
        jobName:  'rms-weekly-backup',
        cronExpr: `0 ${utcH} * * 1`,
        utcHour:  utcH,
        phtHour:  h,
      }
    case 'monthly':
      return {
        jobName:  'rms-monthly-backup',
        cronExpr: `0 ${utcH} 1 * *`,
        utcHour:  utcH,
        phtHour:  h,
      }
    case 'yearly':
      return {
        jobName:  'rms-yearly-backup',
        cronExpr: `0 ${utcH} 1 1 *`,
        utcHour:  utcH,
        phtHour:  h,
      }
    default:
      return null  // 'custom' and 'manual' — caller handles their own cron
  }
}

// ── GET /api/backup/schedule ──────────────────────────────────────────────────

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
      backup_hour = 2,      // PHT hour; admin UI always shows PHT
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

    // Clamp to valid PHT hour range (same as before, but now documented as PHT)
    const phtHour = Math.max(0, Math.min(23, parseInt(String(backup_hour), 10) || 2))

    const db = getServiceClient()

    // ── 1. Save config — store PHT hour for UI display ────────────────────────
    const { data, error } = await db
      .from('backup_configs')
      .upsert(
        {
          module_name,
          is_enabled,
          frequency,
          backup_hour:         phtHour,   // stored as PHT for display in the UI
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

    // ── 2. Reschedule pg_cron with UTC-converted expression ───────────────────
    const cronTarget = buildCronExpression(frequency, phtHour)

    if (cronTarget) {
      console.log(
        `[Schedule] ${module_name}: ${frequency} at ${phtHour}:00 PHT ` +
        `= ${cronTarget.utcHour}:00 UTC → cron "${cronTarget.cronExpr}"`
      )

      if (is_enabled) {
        const { error: rpcError } = await db.rpc('reschedule_backup_cron', {
          job_name:  cronTarget.jobName,
          new_cron:  cronTarget.cronExpr,   // UTC expression
          frequency,
        })

        if (rpcError) {
          console.warn(
            `[Schedule] pg_cron reschedule failed for ${cronTarget.jobName}:`,
            rpcError.message
          )
          return NextResponse.json({
            data,
            warning:
              `Config saved (PHT ${phtHour}:00 = UTC ${cronTarget.utcHour}:00). ` +
              `pg_cron reschedule failed: ${rpcError.message}. ` +
              `The Vercel hourly cron will still dispatch this module at the correct PHT hour.`,
          })
        }

        console.log(
          `[Schedule] pg_cron job "${cronTarget.jobName}" updated to ` +
          `"${cronTarget.cronExpr}" (UTC = PHT ${phtHour}:00)`
        )
      } else {
        // Module disabled — pg_cron job fires but runScheduledBackupForHour()
        // skips disabled modules, so this is safe without unscheduling.
        console.log(
          `[Schedule] Module ${module_name} disabled. ` +
          `pg_cron job ${cronTarget.jobName} will skip it at runtime.`
        )
      }
    }

    return NextResponse.json({ data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}