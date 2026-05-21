// lib/backup/notifications.ts
// Utility used by engine.ts to insert a backup_notifications row after
// each backup job completes (success or failure).
//
// NOTE: The API route handlers live in app/api/backup/notifications/route.ts.
// This file is the server-side helper only — no HTTP, no route exports.

import { getServiceClient } from '@/lib/gdrive-pool/db'

export interface NotifyBackupResultOptions {
  jobId:        string
  module_name:  string
  success:      boolean
  folderName?:  string
  durationSecs?: number
  totalBytes?:  number
  error?:       string
}

/**
 * Inserts a row into backup_notifications so the admin dashboard
 * can surface success/failure alerts without polling backup_jobs directly.
 *
 * Called from engine.ts after every backup run.
 * Non-fatal: if the insert fails, we log a warning but do not throw.
 */
export async function notifyBackupResult(opts: NotifyBackupResultOptions): Promise<void> {
  const db = getServiceClient()

  const title = opts.success
    ? `Backup completed — ${opts.module_name}`
    : `Backup failed — ${opts.module_name}`

  const body = opts.success
    ? [
        `Folder: ${opts.folderName ?? 'n/a'}`,
        `Duration: ${opts.durationSecs ?? 0}s`,
        `Size: ${formatBytes(opts.totalBytes ?? 0)}`,
      ].join(' · ')
    : `Error: ${opts.error ?? 'Unknown error'}`

  const { error } = await db.from('backup_notifications').insert({
    job_id:    opts.jobId,
    type:      opts.success ? 'success' : 'error',
    title,
    body,
    is_read:   false,
    created_at: new Date().toISOString(),
  })

  if (error) {
    console.warn(`[Notifications] Failed to insert notification for job ${opts.jobId}:`, error.message)
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`
  if (bytes < 1024 ** 2)   return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3)   return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}