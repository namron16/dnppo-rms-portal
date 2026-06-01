// lib/backup/dev-mode.ts
//
// Development-only helpers that let you test the full backup pipeline
// without needing:
//   • A connected Google Drive account (skips attachment downloads)
//   • A real Supabase Storage bucket called "backup-staging"
//     (saves the ZIP to the local /tmp folder instead)
//   • CRON_SECRET (manual trigger doesn't need it anyway)
//
// HOW TO ENABLE:
//   Add this to your .env.local:
//     BACKUP_DEV_MODE=true
//
// In production (NODE_ENV=production) dev mode is ALWAYS disabled,
// even if the env var is set. This file is safe to ship.
//
// WHAT CHANGES IN DEV MODE:
//   1. Attachment downloads from Google Drive are SKIPPED.
//      A placeholder buffer is used instead so the ZIP still has the
//      correct folder structure and the manifest is still generated.
//   2. The ZIP is written to /tmp/<folderName>.zip instead of Supabase Storage.
//      The download_url stored in backup_jobs will be a local file:// path
//      (useless for clicking, but the job still completes with status="completed").
//   3. The Supabase Storage upload is skipped entirely, so you don't need
//      the backup-staging bucket to exist.
//
// HOW TO SEE THE OUTPUT:
//   After triggering a backup, look in your terminal for:
//     [DevMode] ZIP saved to /tmp/Backup_<date>_<module>.zip
//   You can open that file to inspect the contents.

import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export const DEV_MODE =
  process.env.BACKUP_DEV_MODE === 'true' && process.env.NODE_ENV !== 'production'

/**
 * In dev mode, returns a placeholder buffer instead of downloading from Drive.
 * Logs a warning so you know downloads are being skipped.
 */
export function devModeAttachmentPlaceholder(fileName: string): Buffer {
  const msg =
    `[DEV MODE PLACEHOLDER]\n` +
    `File: ${fileName}\n` +
    `This file was not downloaded from Google Drive because BACKUP_DEV_MODE=true.\n` +
    `In production the real file bytes would be here.\n`
  return Buffer.from(msg, 'utf8')
}

/**
 * In dev mode, writes the ZIP blob to /tmp and returns a local path string.
 * In production, this function should never be called.
 */
export async function devModeSaveZip(
  folderName: string,
  blob: Blob
): Promise<string> {
  const tmpDir  = '/tmp'
  const zipPath = join(tmpDir, `${folderName}.zip`)

  try {
    const arrayBuffer = await blob.arrayBuffer()
    const buffer      = Buffer.from(arrayBuffer)
    writeFileSync(zipPath, buffer)
    console.log(`[DevMode] ZIP saved locally: ${zipPath} (${(buffer.length / 1024).toFixed(1)} KB)`)
    return `file://${zipPath}`
  } catch (err: any) {
    console.error(`[DevMode] Could not write ZIP to ${zipPath}:`, err.message)
    // Return a fake URL so the job still completes — easier to see what failed
    return `file://${zipPath}__WRITE_FAILED`
  }
}

/**
 * Call at the top of any server file to log whether dev mode is active.
 * Helps prevent accidentally running with BACKUP_DEV_MODE=true in staging.
 */
export function logDevModeStatus(): void {
  if (DEV_MODE) {
    console.warn(
      '\n' +
      '╔══════════════════════════════════════════════════════════╗\n' +
      '║  BACKUP DEV MODE IS ACTIVE (BACKUP_DEV_MODE=true)       ║\n' +
      '║  • Drive attachment downloads will be SKIPPED            ║\n' +
      '║  • ZIPs will be saved to /tmp instead of Supabase Storage║\n' +
      '║  • Do NOT use this setting in production                 ║\n' +
      '╚══════════════════════════════════════════════════════════╝\n'
    )
  }
}