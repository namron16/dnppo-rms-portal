// lib/backup/recovery.ts

import { getServiceClient } from '@/lib/gdrive-pool/db'
import { decryptBackupData, verifyChecksum } from './encryption'
import { uploadViaPool } from '@/lib/gdrive-pool/migrate-modal'
import { verifyManifestIntegrity, type BackupManifest } from './manifest'
import type { BackupModuleName } from './modules'
import { BACKUP_MODULES } from './modules'

export interface RecoveryOptions {
  backup_job_id: string
  module_name:   BackupModuleName
  /**
   * The role/username that triggered the recovery.
   * Files are re-uploaded to this user's Drive pool.
   * FIX: was defaulting to 'DPDA' (a view-only role). Now defaults to 'admin'.
   */
  triggered_by?: string
}

export interface RecoveryResult {
  success:          boolean
  recoveryJobId:    string
  recordsRestored:  number
  filesRestored:    number
  validationPassed: boolean
  durationSecs:     number
  rollbackSnapshot: string
  error?:           string
}

export async function runRecovery(opts: RecoveryOptions): Promise<RecoveryResult> {
  const db    = getServiceClient()
  const start = Date.now()

  // FIX: was hardcoded to 'DPDA' — now defaults to 'admin' which is the only
  // role allowed to trigger recovery (enforced by recover/route.ts).
  const triggeredBy = opts.triggered_by ?? 'admin'

  const { data: recoveryJob } = await db
    .from('recovery_jobs')
    .insert({
      backup_job_id: opts.backup_job_id,
      module_name:   opts.module_name,
      status:        'running',
      triggered_by:  triggeredBy,
      started_at:    new Date().toISOString(),
    })
    .select()
    .single()

  const recoveryJobId = recoveryJob!.id

  try {
    // ── 1. Load backup job metadata ──────────────────────────────────────────
    const { data: backupJob } = await db
      .from('backup_jobs')
      .select('*')
      .eq('id', opts.backup_job_id)
      .single()

    if (!backupJob)                       throw new Error('Backup job not found.')
    if (backupJob.status !== 'completed') throw new Error('Cannot recover from a non-completed backup.')
    if (!backupJob.download_url)          throw new Error('Backup has no stored download URL — cannot load ZIP.')

    // ── 2. Download and parse backup ZIP ─────────────────────────────────────
    console.log(`[Recovery] Loading backup: ${backupJob.backup_folder_name}`)
    const zip = await loadBackupZip(backupJob.download_url)

    // ── 3. Parse and validate manifest ───────────────────────────────────────
    const manifest = await extractManifest(zip, backupJob.backup_folder_name)

    if (!verifyManifestIntegrity(manifest)) {
      throw new Error('Manifest integrity check failed — backup may be corrupted or tampered with.')
    }

    // Cross-check manifest checksum against the value stored in backup_jobs
    const manifestJson    = JSON.stringify(manifest)
    const recomputedCheck = require('crypto')
      .createHash('sha256')
      .update(Buffer.from(manifestJson))
      .digest('hex')

    if (recomputedCheck !== backupJob.manifest_checksum) {
      throw new Error('Manifest checksum mismatch against backup_jobs record — aborting recovery.')
    }

    console.log(`[Recovery] Manifest validated. Module: ${manifest.module}`)

    // ── 4. Create pre-recovery snapshot (rollback protection) ────────────────
    const rollbackSnapshot = await createRollbackSnapshot(opts.module_name)
    console.log(`[Recovery] Rollback snapshot created: ${rollbackSnapshot}`)

    await db
      .from('recovery_jobs')
      .update({ rollback_snapshot: rollbackSnapshot })
      .eq('id', recoveryJobId)

    // ── 5. Restore database records ──────────────────────────────────────────
    let recordsRestored = 0
    const moduleDef     = BACKUP_MODULES[opts.module_name]

    for (const tableName of moduleDef.tables) {
      const tableData = await extractTableData(zip, tableName, backupJob.backup_folder_name)
      if (!tableData || tableData.length === 0) {
        console.warn(`[Recovery] No data found for table ${tableName} — skipping.`)
        continue
      }

      const { error } = await db
        .from(tableName)
        .upsert(tableData, { onConflict: 'id', ignoreDuplicates: false })

      if (error) throw new Error(`Restore table ${tableName} failed: ${error.message}`)
      recordsRestored += tableData.length
      console.log(`[Recovery] Restored ${tableData.length} rows into ${tableName}`)
    }

    // ── 6. Re-upload file attachments to Drive ───────────────────────────────
    let filesRestored = 0

    if (manifest.contents?.attachments) {
      for (const docEntry of manifest.contents.attachments.files ?? []) {
        for (const att of docEntry.attachments ?? []) {
          if ((att as any).error) continue

          try {
            const fileBuffer = await extractFile(zip, att.file)

            if (!verifyChecksum(fileBuffer, att.checksum)) {
              console.warn(`[Recovery] Checksum mismatch for ${att.file} — skipping`)
              continue
            }

            const def        = moduleDef as any
            const entityType = typeof def.entity_type === 'string' ? def.entity_type : undefined

            await uploadViaPool({
              file:          fileBuffer,
              fileName:      att.file.split('/').pop()!,
              mimeType:      'application/octet-stream',
              category:      moduleDef.gdrive_category as any,
              entityType,
              entityId:      docEntry.document_id,
              uploadedBy:    triggeredBy,
              fileSizeBytes: fileBuffer.length,
            })

            filesRestored++
          } catch (err: any) {
            console.warn(`[Recovery] Could not restore file ${att.file}:`, err.message)
          }
        }
      }
    }

    // ── 7. Post-recovery validation ──────────────────────────────────────────
    const validationPassed = await validateRecovery(opts.module_name, recordsRestored)
    const durationSecs     = Math.round((Date.now() - start) / 1000)

    // ── 8. Finalize recovery job ─────────────────────────────────────────────
    await db.from('recovery_jobs').update({
      status:            'completed',
      completed_at:      new Date().toISOString(),
      duration_seconds:  durationSecs,
      records_restored:  recordsRestored,
      files_restored:    filesRestored,
      validation_passed: validationPassed,
    }).eq('id', recoveryJobId)

    console.log(`[Recovery] Complete: ${recordsRestored} records, ${filesRestored} files`)

    return {
      success:          true,
      recoveryJobId,
      recordsRestored,
      filesRestored,
      validationPassed,
      durationSecs,
      rollbackSnapshot,
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    console.error(`[Recovery] Job ${recoveryJobId} FAILED:`, msg)

    await db.from('recovery_jobs').update({
      status:        'failed',
      completed_at:  new Date().toISOString(),
      error_message: msg,
    }).eq('id', recoveryJobId)

    return {
      success:          false,
      recoveryJobId,
      recordsRestored:  0,
      filesRestored:    0,
      validationPassed: false,
      durationSecs:     Math.round((Date.now() - start) / 1000),
      rollbackSnapshot: '',
      error:            msg,
    }
  }
}

// ── ZIP helpers (replaced stubs with real JSZip implementations) ──────────────

/**
 * Downloads the backup ZIP from the signed URL returned by storeBackupBlob()
 * and loads it into JSZip for reading.
 */
async function loadBackupZip(downloadUrl: string): Promise<any> {
  const JSZip = (await import('jszip')).default

  const response = await fetch(downloadUrl)
  if (!response.ok) {
    throw new Error(`Failed to download backup ZIP (${response.status}): ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return JSZip.loadAsync(arrayBuffer)
}

/**
 * Extracts and parses MANIFEST.json from the ZIP.
 * The manifest lives at <folderName>/MANIFEST.json.
 */
async function extractManifest(zip: any, folderName: string): Promise<BackupManifest> {
  const manifestPath = `${folderName}/MANIFEST.json`
  const file         = zip.file(manifestPath)

  if (!file) {
    throw new Error(`MANIFEST.json not found in backup ZIP at path: ${manifestPath}`)
  }

  const content = await file.async('string')
  return JSON.parse(content) as BackupManifest
}

/**
 * Extracts, decrypts, and parses a database table JSON from the ZIP.
 * Matches the first file under <folderName>/database/ whose name starts
 * with the table name.
 */
async function extractTableData(
  zip:        any,
  tableName:  string,
  folderName: string
): Promise<any[]> {
  const prefix  = `${folderName}/database/${tableName}_`
  const entries = Object.keys(zip.files).filter(
    name => name.startsWith(prefix) && !zip.files[name].dir
  )

  if (entries.length === 0) return []

  const file      = zip.file(entries[0])
  const rawBuffer = Buffer.from(await file.async('arraybuffer'))

  // Determine if file is encrypted (.json.enc) or plain (.json / .xlsx)
  if (entries[0].endsWith('.enc')) {
    const decrypted = await decryptBackupData(rawBuffer)
    return JSON.parse(decrypted.toString('utf8'))
  }

  // Plain JSON (shouldn't normally happen, but handle gracefully)
  return JSON.parse(rawBuffer.toString('utf8'))
}

/**
 * Extracts a single attachment file from the ZIP by its relative path.
 * Path is relative to the folder root, e.g. "attachments/docId/file.pdf".
 */
async function extractFile(zip: any, relativePath: string): Promise<Buffer> {
  // The ZIP was built with folderName as the root folder, so search
  // for any file whose path ends with the relative path.
  const candidates = Object.keys(zip.files).filter(
    name => name.endsWith(`/${relativePath}`) || name === relativePath
  )

  if (candidates.length === 0) {
    throw new Error(`File not found in backup ZIP: ${relativePath}`)
  }

  const file = zip.file(candidates[0])
  return Buffer.from(await file.async('arraybuffer'))
}

// ── Snapshot & validation helpers ─────────────────────────────────────────────

async function createRollbackSnapshot(module_name: BackupModuleName): Promise<string> {
  const db        = getServiceClient()
  const moduleDef = BACKUP_MODULES[module_name]
  const snapshot:  Record<string, any[]> = {}

  for (const tableName of moduleDef.tables) {
    const { data } = await db.from(tableName).select('*')
    snapshot[tableName] = data ?? []
  }

  const snapshotId = `rollback_${module_name}_${Date.now()}`

  // Persist to backup_snapshots table for rollback if needed
  const { error } = await db.from('backup_snapshots').insert({
    snapshot_id:  snapshotId,
    module_name,
    snapshot_data: snapshot,
    created_at:   new Date().toISOString(),
  })

  if (error) {
    console.warn(`[Recovery] Could not persist rollback snapshot: ${error.message}`)
  }

  return snapshotId
}

async function validateRecovery(
  module_name:   BackupModuleName,
  expectedCount: number
): Promise<boolean> {
  const db           = getServiceClient()
  const moduleDef    = BACKUP_MODULES[module_name]
  const primaryTable = moduleDef.tables[0]

  const { count } = await db
    .from(primaryTable)
    .select('id', { count: 'exact', head: true })

  return (count ?? 0) >= expectedCount
}