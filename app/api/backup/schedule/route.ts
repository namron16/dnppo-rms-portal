// app/api/backup/schedule/route.ts
//
// FIX-4: backup_hour PHT→UTC conversion.
// Enhanced: structured error codes on every failure path.

import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { requireAdmin, AuthError } from '@/lib/backup/auth-guard'
import { BACKUP_MODULES } from '@/lib/backup/modules'

export const runtime = 'nodejs'

const PHT_OFFSET_HOURS = 8

function phtHourToUtc(phtHour: number): number {
  return ((phtHour - PHT_OFFSET_HOURS) + 24) % 24
}

function buildCronExpression(
  frequency: string,
  phtHour:   number
): { jobName: string; cronExpr: string; utcHour: number; phtHour: number } | null {
  const h    = Math.max(0, Math.min(23, Math.floor(phtHour)))
  const utcH = phtHourToUtc(h)

  switch (frequency) {
    case 'daily':
      return { jobName: 'rms-daily-backup',   cronExpr: `0 ${utcH} * * *`,   utcHour: utcH, phtHour: h }
    case 'weekly':
      return { jobName: 'rms-weekly-backup',  cronExpr: `0 ${utcH} * * 1`,   utcHour: utcH, phtHour: h }
    case 'monthly':
      return { jobName: 'rms-monthly-backup', cronExpr: `0 ${utcH} 1 * *`,   utcHour: utcH, phtHour: h }
    case 'yearly':
      return { jobName: 'rms-yearly-backup',  cronExpr: `0 ${utcH} 1 1 *`,   utcHour: utcH, phtHour: h }
    default:
      return null
  }
}

// ── GET /api/backup/schedule ──────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await requireAdmin()
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json(err.toJSON(), { status: 403 })
    }
    return NextResponse.json({
      error:  'Auth check failed.',
      code:   'AUTH_UNEXPECTED',
      detail: err?.message ?? String(err),
    }, { status: 403 })
  }

  const db = getServiceClient()
  const { data, error } = await db
    .from('backup_configs')
    .select('*')
    .order('module_name')

  if (error) {
    return NextResponse.json({
      error:  'Failed to fetch backup schedule configurations.',
      code:   'CONFIG_FETCH_ERROR',
      detail: `${error.code}: ${error.message}. ` +
        `Check that migration 004 has been run and SUPABASE_SERVICE_ROLE_KEY is correct.`,
    }, { status: 500 })
  }

  return NextResponse.json({ data })
}

// ── POST /api/backup/schedule ─────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    await requireAdmin()
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json(err.toJSON(), { status: 403 })
    }
    return NextResponse.json({
      error:  'Auth check failed.',
      code:   'AUTH_UNEXPECTED',
      detail: err?.message ?? String(err),
    }, { status: 403 })
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({
      error:  'Invalid request body — expected JSON.',
      code:   'INVALID_BODY',
    }, { status: 400 })
  }

  const {
    module_name,
    is_enabled,
    frequency,
    backup_hour = 2,
    custom_cron,
    backup_type,
    include_attachments,
    encrypt_backup,
    retention_days,
    destination_path,
  } = body

  // ── Validate ───────────────────────────────────────────────────────────────
  if (!module_name) {
    return NextResponse.json({
      error:  'module_name is required.',
      code:   'MISSING_FIELD',
      detail: `Valid module names: ${Object.keys(BACKUP_MODULES).join(', ')}`,
    }, { status: 400 })
  }

  if (!(module_name in BACKUP_MODULES)) {
    return NextResponse.json({
      error:  `Unknown module_name: "${module_name}".`,
      code:   'INVALID_MODULE',
      detail: `Valid module names: ${Object.keys(BACKUP_MODULES).join(', ')}`,
    }, { status: 400 })
  }

  const validFrequencies = ['daily', 'weekly', 'monthly', 'yearly', 'custom', 'manual']
  if (frequency && !validFrequencies.includes(frequency)) {
    return NextResponse.json({
      error:  `Invalid frequency: "${frequency}".`,
      code:   'INVALID_FREQUENCY',
      detail: `Valid values: ${validFrequencies.join(', ')}`,
    }, { status: 400 })
  }

  const phtHour = Math.max(0, Math.min(23, parseInt(String(backup_hour), 10) || 2))
  const db      = getServiceClient()

  // ── 1. Upsert config ───────────────────────────────────────────────────────
  const { data, error: upsertErr } = await db
    .from('backup_configs')
    .upsert(
      {
        module_name,
        is_enabled,
        frequency,
        backup_hour:         phtHour,
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

  if (upsertErr) {
    return NextResponse.json({
      error:  `Failed to save backup config for "${module_name}".`,
      code:   'CONFIG_SAVE_ERROR',
      detail: `${upsertErr.code}: ${upsertErr.message}. ` +
        `Hint: ${upsertErr.hint ?? 'none'}. ` +
        `Check that the backup_hour column exists (migration 004) and ` +
        `that SUPABASE_SERVICE_ROLE_KEY is set.`,
    }, { status: 500 })
  }

  // ── 2. Reschedule pg_cron ──────────────────────────────────────────────────
  const cronTarget = buildCronExpression(frequency, phtHour)

  if (cronTarget && is_enabled) {
    const utcDesc = `PHT ${phtHour}:00 = UTC ${cronTarget.utcHour}:00 → "${cronTarget.cronExpr}"`
    console.log(`[Schedule] ${module_name}: ${frequency} at ${utcDesc}`)

    const { error: rpcError } = await db.rpc('reschedule_backup_cron', {
      job_name:  cronTarget.jobName,
      new_cron:  cronTarget.cronExpr,
      frequency,
    })

    if (rpcError) {
      // Config saved — this is a non-fatal warning, not a hard failure
      const isPgCronMissing =
        rpcError.message.includes('cron') ||
        rpcError.message.includes('function') ||
        rpcError.code === '42883'

      const hint = isPgCronMissing
        ? 'pg_cron may not be enabled. Enable it in Supabase Dashboard → Database → Extensions → pg_cron. ' +
          'The Vercel hourly cron (/api/backup/cron) will still fire this module at the correct PHT hour.'
        : `RPC error: ${rpcError.code}: ${rpcError.message}`

      console.warn(
        `[Schedule] pg_cron reschedule failed for "${cronTarget.jobName}": ` +
        `${rpcError.code}: ${rpcError.message}`
      )

      return NextResponse.json({
        data,
        warning: `Config saved (${utcDesc}). pg_cron reschedule failed: ${hint}`,
        code:    'PGCRON_RESCHEDULE_FAILED',
      })
    }

    console.log(
      `[Schedule] pg_cron job "${cronTarget.jobName}" rescheduled to "${cronTarget.cronExpr}" ` +
      `(${utcDesc})`
    )
  }

  return NextResponse.json({ data })
}