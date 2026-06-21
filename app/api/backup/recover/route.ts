// app/api/backup/recover/route.ts
// Enhanced: structured errors with code + detail on every failure path.

import { NextResponse } from 'next/server'
import { runRecovery } from '@/lib/backup/recovery'
import { requireAdmin, getCurrentUser, AuthError } from '@/lib/backup/auth-guard'
import { BACKUP_MODULES } from '@/lib/backup/modules'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { logRestoreBackup } from '@/lib/adminLogger'

export const runtime     = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  // ── 1. Auth guard ──────────────────────────────────────────────────────────
  let triggeredBy = 'admin'

  try {
    await requireAdmin()
    const currentUser = await getCurrentUser()
    if (currentUser?.role) triggeredBy = currentUser.role
  } catch (err: any) {
    if (err instanceof AuthError) {
      console.warn(`[Recovery] Auth rejected: code=${err.code} — ${err.message}`)
      return NextResponse.json(err.toJSON(), { status: 403 })
    }
    return NextResponse.json({
      error:  'Authentication check failed with an unexpected error.',
      code:   'AUTH_UNEXPECTED',
      detail: err?.message ?? String(err),
    }, { status: 403 })
  }

  // ── 2. Parse body ──────────────────────────────────────────────────────────
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

  const { backup_job_id, module_name, confirm } = body

  // ── 3. Validate required fields ────────────────────────────────────────────
  if (!confirm) {
    return NextResponse.json({
      error:  'Recovery requires explicit confirmation.',
      code:   'CONFIRMATION_REQUIRED',
      detail: 'Send { confirm: true } in the request body to proceed. ' +
        'This is a safeguard — recovery OVERWRITES existing data.',
    }, { status: 400 })
  }

  if (!backup_job_id) {
    return NextResponse.json({
      error:  'backup_job_id is required.',
      code:   'MISSING_FIELD',
      detail: 'Provide the UUID of the completed backup_jobs row to restore from.',
    }, { status: 400 })
  }

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

  // ── 4. Verify the backup job exists and is completed ──────────────────────
  const db = getServiceClient()

  const { data: backupJob, error: jobFetchErr } = await db
    .from('backup_jobs')
    .select('id, status, module_name, download_url, backup_folder_name')
    .eq('id', backup_job_id)
    .maybeSingle()

  if (jobFetchErr) {
    return NextResponse.json({
      error:  `Database error while looking up backup job "${backup_job_id}".`,
      code:   'JOB_FETCH_ERROR',
      detail: `${jobFetchErr.code}: ${jobFetchErr.message}. ` +
        `Ensure SUPABASE_SERVICE_ROLE_KEY is set and migration 004 has been run.`,
    }, { status: 500 })
  }

  if (!backupJob) {
    return NextResponse.json({
      error:  `Backup job "${backup_job_id}" was not found.`,
      code:   'JOB_NOT_FOUND',
      detail: `No row in backup_jobs matches this ID. ` +
        `The job may have been deleted by the retention cleanup cron.`,
    }, { status: 404 })
  }

  if (backupJob.status !== 'completed') {
    return NextResponse.json({
      error:  `Cannot recover from backup job "${backup_job_id}" — status is "${backupJob.status}".`,
      code:   'JOB_NOT_COMPLETED',
      detail: `Only jobs with status="completed" can be used for recovery. ` +
        `Current status: ${backupJob.status}.`,
    }, { status: 400 })
  }

  if (!backupJob.download_url) {
    return NextResponse.json({
      error:  `Backup job "${backup_job_id}" has no download URL.`,
      code:   'MISSING_DOWNLOAD_URL',
      detail: `The backup ZIP was not stored to Supabase Storage, or the signed URL expired. ` +
        `The backup may need to be re-run. Folder: "${backupJob.backup_folder_name ?? 'unknown'}"`,
    }, { status: 400 })
  }

  if (backupJob.module_name !== module_name) {
    return NextResponse.json({
      error:  `Module mismatch: job "${backup_job_id}" backed up "${backupJob.module_name}", ` +
        `but recovery was requested for "${module_name}".`,
      code:   'MODULE_MISMATCH',
      detail: `Pass the correct module_name matching the backup job.`,
    }, { status: 400 })
  }

  // ── 5. Run recovery ────────────────────────────────────────────────────────
  try {
    const result = await runRecovery({
      backup_job_id,
      module_name,
      triggered_by: triggeredBy,
    })

    
    void logRestoreBackup(
        module_name,
        backup_job_id,
        result.recoveryJobId,
        result.recordsRestored,
        result.filesRestored
      )

    return NextResponse.json({ data: result })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    console.error(`[Recovery] runRecovery threw for job "${backup_job_id}":`, msg)

    // Classify common recovery errors for easier debugging
    let code = 'RECOVERY_FAILED'
    let detail = msg

    if (msg.includes('Manifest integrity check failed')) {
      code   = 'MANIFEST_INTEGRITY_FAILED'
      detail = `The MANIFEST.json inside the backup ZIP failed its SHA-256 checksum. ` +
        `The backup may be corrupted or tampered with. Run a new backup and retry.`
    } else if (msg.includes('Manifest checksum mismatch')) {
      code   = 'MANIFEST_CHECKSUM_MISMATCH'
      detail = `The manifest checksum stored in backup_jobs does not match the ZIP contents. ` +
        `The backup record may have been altered. Run a new backup and retry.`
    } else if (msg.includes('Failed to download backup ZIP')) {
      code   = 'ZIP_DOWNLOAD_FAILED'
      detail = `Could not fetch the backup ZIP from Supabase Storage. ` +
        `The signed URL may have expired (1-hour TTL). Re-trigger the recovery. ` +
        `Original error: ${msg}`
    } else if (msg.includes('upsert') || msg.includes('Restore table')) {
      code   = 'TABLE_RESTORE_FAILED'
      detail = `A database upsert failed during restoration. ` +
        `Check that the target table's schema matches the backup (no missing columns). ` +
        `Original error: ${msg}`
    } else if (msg.includes('Drive') || msg.includes('drive') || msg.includes('gdrive')) {
      code   = 'GDRIVE_RESTORE_FAILED'
      detail = `A file could not be re-uploaded to Google Drive. ` +
        `Check that Drive accounts are connected and have free space. ` +
        `Original error: ${msg}`
    } else if (msg.includes('rollback snapshot')) {
      code   = 'SNAPSHOT_FAILED'
      detail = `The pre-recovery rollback snapshot could not be saved. ` +
        `Check the backup_snapshots table exists (run migration add_backup_snapshots_table). ` +
        `Original error: ${msg}`
    }

    return NextResponse.json({
      error: `Recovery failed: ${msg}`,
      code,
      detail,
    }, { status: 500 })
  }
}