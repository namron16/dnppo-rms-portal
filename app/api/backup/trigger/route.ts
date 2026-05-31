// app/api/backup/trigger/route.ts
//
// POST — manually triggers a backup for one module.
// Enhanced: errors now include a code + detail field so you know exactly
// which step failed (auth, config fetch, job insert, or backup engine).

import { NextResponse } from 'next/server'
import { runModuleBackup } from '@/lib/backup/engine'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { requireAdmin, getCurrentUser, AuthError } from '@/lib/backup/auth-guard'
import type { BackupModuleName } from '@/lib/backup/modules'
import { BACKUP_MODULES } from '@/lib/backup/modules'

export const runtime     = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  // ── 1. Auth guard ──────────────────────────────────────────────────────────
  try {
    await requireAdmin()
  } catch (err: any) {
    if (err instanceof AuthError) {
      console.warn(`[Trigger] Auth rejected: code=${err.code} — ${err.message}`)
      return NextResponse.json(err.toJSON(), { status: 403 })
    }
    return NextResponse.json({
      error:  'Authentication check failed with an unexpected error.',
      code:   'AUTH_UNEXPECTED',
      detail: err?.message ?? String(err),
    }, { status: 403 })
  }

  // ── 2. Resolve triggered_by from session ───────────────────────────────────
  let triggeredBy = 'admin'
  try {
    const currentUser = await getCurrentUser()
    if (currentUser?.role) triggeredBy = currentUser.role
  } catch (err: any) {
    // Non-fatal: we already know they're admin. Fall back gracefully.
    console.warn('[Trigger] Could not resolve triggered_by from session:', err?.message)
  }

  // ── 3. Parse and validate body ─────────────────────────────────────────────
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({
      error:  'Invalid request body — expected JSON.',
      code:   'INVALID_BODY',
      detail: 'Ensure Content-Type is application/json and the body is valid JSON.',
    }, { status: 400 })
  }

  const { module_name, backup_type = 'full' } = body

  if (!module_name) {
    return NextResponse.json({
      error:  'module_name is required.',
      code:   'MISSING_FIELD',
      detail: `Valid module names: ${Object.keys(BACKUP_MODULES).join(', ')}`,
    }, { status: 400 })
  }

  // Check the module name is actually valid
  if (!(module_name in BACKUP_MODULES)) {
    return NextResponse.json({
      error:  `Unknown module_name: "${module_name}".`,
      code:   'INVALID_MODULE',
      detail: `Valid module names: ${Object.keys(BACKUP_MODULES).join(', ')}`,
    }, { status: 400 })
  }

  const db = getServiceClient()

  // ── 4. Check is_enabled ────────────────────────────────────────────────────
  const { data: config, error: configErr } = await db
    .from('backup_configs')
    .select('is_enabled')
    .eq('module_name', module_name)
    .maybeSingle()

  if (configErr) {
    console.error(
      `[Trigger] Could not read backup_configs for "${module_name}": ` +
      `code=${configErr.code}, message=${configErr.message}`
    )
    return NextResponse.json({
      error:  `Database error reading backup config for "${module_name}".`,
      code:   'CONFIG_FETCH_ERROR',
      detail: `${configErr.code}: ${configErr.message}. Check that migration 004 has been run.`,
    }, { status: 500 })
  }

  if (config !== null && config.is_enabled === false) {
    return NextResponse.json({
      error:  `Backups for "${module_name}" are currently disabled.`,
      code:   'MODULE_DISABLED',
      detail: `Enable the module in Backup → Schedule settings, then retry.`,
    }, { status: 403 })
  }

  // ── 5. Create pending job record ───────────────────────────────────────────
  const { data: job, error: jobErr } = await db
    .from('backup_jobs')
    .insert({
      module_name,
      backup_type,
      frequency:    'manual',
      status:       'pending',
      triggered_by: triggeredBy,
      started_at:   new Date().toISOString(),
    })
    .select()
    .single()

  if (jobErr || !job) {
    const detail = jobErr
      ? `code=${jobErr.code}, message=${jobErr.message}, hint=${jobErr.hint ?? 'none'}`
      : 'insert returned no row'

    console.error(`[Trigger] backup_jobs insert failed: ${detail}`)

    return NextResponse.json({
      error:  'Could not create a backup job record in the database.',
      code:   'JOB_INSERT_FAILED',
      detail: `${detail}. ` +
        `Check RLS on backup_jobs (service role should bypass it) ` +
        `and that SUPABASE_SERVICE_ROLE_KEY is set correctly.`,
    }, { status: 500 })
  }

  // ── 6. Fire backup asynchronously — return job ID immediately ─────────────
  runModuleBackup({ jobId: job.id, module_name, backup_type })
    .catch(err => {
      console.error(
        `[Trigger] Job ${job.id} (${module_name}) threw after async dispatch:`,
        err?.message ?? err
      )
    })

  console.log(
    `[Trigger] Job ${job.id} started for module="${module_name}", ` +
    `backup_type="${backup_type}", triggered_by="${triggeredBy}"`
  )

  return NextResponse.json(
    {
      data: {
        jobId:   job.id,
        status:  'running',
        message: `Backup started for ${module_name}`,
      },
    },
    { status: 202 }
  )
}