// app/api/backup/trigger/route.ts
//
// POST — manually triggers a backup for one module.
//
// ROOT CAUSE OF "stuck at running forever, no errors":
// This route used to fire `runModuleBackup(...)` without awaiting it, then
// immediately returned a 202 response. On Vercel, a serverless function's
// execution context can be frozen or torn down as soon as the response is
// sent — orphaned promises are NOT guaranteed to keep running. That means
// the backup engine could be killed mid-flight before it ever updates the
// job status, downloads attachments, or logs an error. This is why nothing
// showed up in the logs: the function was terminated, not failed.
//
// FIX: wrap the detached work in Vercel's waitUntil(), which explicitly
// extends the function's lifetime until the given promise settles. This is
// the documented, supported way to do "respond now, finish work after" on
// Vercel. See: https://vercel.com/docs/functions/functions-api-reference
//
// NOTE: waitUntil() still respects the route's maxDuration (300s here), so
// very long backups can still hit the limit — but at minimum the job will
// now either complete or be correctly killed in a way that's consistent
// with the timeout, not silently abandoned the instant the response flushes.

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
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

  // ── 5. Create job record (status = 'pending') ──────────────────────────────
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

  // ── 6. Immediately mark as 'running' so the health poller finds it ─────────
  const { error: runningErr } = await db
    .from('backup_jobs')
    .update({ status: 'running' })
    .eq('id', job.id)

  if (runningErr) {
    console.warn(
      `[Trigger] Could not pre-set job ${job.id} to running: ${runningErr.message}`
    )
  }

  // ── 7. Run the backup, kept alive past the response via waitUntil ─────────
  // THIS IS THE CORE FIX. Without waitUntil, Vercel can tear down the
  // function's execution context the instant the response below is sent,
  // killing runModuleBackup mid-execution with no error logged anywhere.
  const backupPromise = runModuleBackup({ jobId: job.id, module_name, backup_type })
    .then(result => {
      if (!result.success) {
        console.error(
          `[Trigger] Job ${job.id} (${module_name}) completed with error: ${result.error}`
        )
      } else {
        console.log(
          `[Trigger] Job ${job.id} (${module_name}) completed successfully ` +
          `in ${result.durationSecs}s, ${result.fileCount} files, ${result.totalBytes} bytes`
        )
      }
    })
    .catch(async err => {
      const msg = err?.message ?? String(err)
      console.error(
        `[Trigger] Job ${job.id} (${module_name}) threw unexpectedly:`,
        msg
      )
      // Mark the job failed so the UI doesn't spin forever even if the
      // engine itself crashed before reaching its own catch block.
      const { error: updateErr } = await db
        .from('backup_jobs')
        .update({
          status:        'failed',
          completed_at:  new Date().toISOString(),
          error_message: `Unhandled engine error: ${msg}`,
        })
        .eq('id', job.id)

      if (updateErr) {
        console.error(
          `[Trigger] Could not mark job ${job.id} as failed after crash:`,
          updateErr.message
        )
      }
    })

  // Tell Vercel: keep this function alive until backupPromise settles,
  // even though we're about to return the HTTP response below.
  waitUntil(backupPromise)

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