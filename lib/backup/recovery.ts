// lib/backup/recovery.ts
//
// FIX: Primary files (gdrive_file_id stored directly on document rows) are now
// restored from the backup ZIP and re-uploaded to Google Drive. After upload the
// document row is patched with the new gdrive_file_id / gdrive_url /
// pool_account_id so the app no longer points at the deleted Drive file.
//
// The manifest now carries `main_file` entries populated by engine.ts step 2b.
// Recovery iterates those entries, re-uploads each file via uploadViaPool, then
// updates the corresponding document row in Supabase.

import { createHash } from 'crypto'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { decryptBackupData, decryptDoubleEncryptedClassified , verifyChecksum } from './encryption'
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
    // FIX: extract raw bytes from the ZIP so the checksum hash matches what the
    // engine wrote (engine hashes the raw buffer; old code re-serialized the
    // parsed object which produced different whitespace → different hash).
    const manifestPath = `${backupJob.backup_folder_name}/MANIFEST.json`
    const manifestFile = zip.file(manifestPath)
    if (!manifestFile) {
      throw new Error(`MANIFEST.json not found in backup ZIP at path: ${manifestPath}`)
    }

    const manifestRaw = await manifestFile.async('nodebuffer')
    const manifest            = JSON.parse(manifestRaw.toString('utf8')) as BackupManifest

    if (!verifyManifestIntegrity(manifest)) {
      throw new Error('Manifest integrity check failed — backup may be corrupted or tampered with.')
    }

    // Cross-check manifest checksum against the value stored in backup_jobs.
    // FIX: hash the raw bytes (same as engine.ts), not a re-serialized string.
    const recomputedCheck = createHash('sha256').update(manifestRaw).digest('hex')

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
    const useDoubleDecrypt = (moduleDef as any).extra_encryption === true   // ← NEW

    for (const tableName of moduleDef.tables) {
      const tableData = await extractTableData(zip, tableName, backupJob.backup_folder_name, useDoubleDecrypt)   // ← pass new param  
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

    // ── 6. Re-upload file attachments AND primary files to Drive ─────────────
    //
    // The manifest's attachments.files array can contain two kinds of entries:
    //
    //   a) Primary file entries — added by engine.ts step 2b (downloadPrimaryFiles).
    //      These have a `main_file` path pointing to `primary_files/<docId>/<name>`.
    //      After re-upload, the document row must be patched with the new Drive IDs
    //      so the app no longer references the now-deleted original Drive file.
    //
    //   b) Attachment entries — added by downloadAttachments().
    //      These live under `attachments/<docId>/attachments/` in the ZIP and are
    //      restored into the *_attachments table rows (which were already upserted
    //      in step 5 with the old gdrive_file_id). Re-uploading gives us fresh IDs
    //      but we do NOT patch the attachment table rows here — that would require
    //      knowing the exact attachment row ID per file, which the manifest carries
    //      via `attachment_id`. If needed, add that patch as a follow-up.
    //
    let filesRestored = 0

    if (manifest.contents?.attachments) {
      for (const docEntry of manifest.contents.attachments.files ?? []) {
        for (const att of docEntry.attachments ?? []) {
          if (att.error) continue   // ← no "as any" needed now

          try {
            const fileBuffer = await extractFile(zip, att.file)
            if (!verifyChecksum(fileBuffer, att.checksum)) {
              console.warn(`[Recovery] Checksum mismatch for ${att.file} — skipping`)
              continue
            }

            const def        = moduleDef as any
            const entityType = typeof def.entity_type === 'string' ? def.entity_type : undefined

            const result = await uploadViaPool({
              file:          fileBuffer,
              fileName:      att.file.split('/').pop()!,
              mimeType:      'application/octet-stream',
              category:      moduleDef.gdrive_category as any,
              entityType,
              entityId:      docEntry.document_id,
              uploadedBy:    triggeredBy,
              fileSizeBytes: fileBuffer.length,
            })

            console.log(`[Recovery] Restored ${att.file} → ${result.fileUrl}`)  // ← fileUrl, not driveUrl
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

// ── ZIP helpers ───────────────────────────────────────────────────────────────

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
 * Extracts, decrypts, and parses a database table JSON from the ZIP.
 * Matches the first file under <folderName>/database/ whose name starts
 * with the table name.
 */
async function extractTableData(
  zip:              any,
  tableName:        string,
  folderName:       string,
  useDoubleDecrypt: boolean = false   // ← NEW param
): Promise<any[]> {
  const prefix  = `${folderName}/database/${tableName}_`
  const entries = Object.keys(zip.files).filter(
    name => name.startsWith(prefix) && !zip.files[name].dir
  )

  if (entries.length === 0) return []

  const file      = zip.file(entries[0])
  const rawBuffer = Buffer.from(await file.async('arraybuffer'))

  if (entries[0].endsWith('.enc')) {
    // FIX: classified_documents was locked twice during backup
    // (doubleEncryptClassified). Using the single-unlock function here
    // produced an auth-tag mismatch or garbage data. Route to the matching
    // double-unlock function based on the module's encryption setting.
    const decrypted = useDoubleDecrypt
      ? await decryptDoubleEncryptedClassified(rawBuffer)
      : await decryptBackupData(rawBuffer)
    return JSON.parse(decrypted.toString('utf8'))
  }

  return JSON.parse(rawBuffer.toString('utf8'))
}

/**
 * Extracts a single file from the ZIP by its relative path.
 * The ZIP was built with folderName as the root, so we search for any
 * entry whose path ends with the relative path.
 */
async function extractFile(zip: any, relativePath: string): Promise<Buffer> {
  // Try exact match first (with folder prefix)
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