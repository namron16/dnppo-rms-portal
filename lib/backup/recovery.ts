// lib/backup/recovery.ts
//
// FIX (file restore): Recovery now re-uploads files to the CORRECT user's
// Drive account by resolving owner_username from the original pool_account_id
// stored on each document/attachment row. Previously it used triggered_by
// ('admin') as uploadedBy, which always failed because admin has no connected
// Drive account — so metadata was restored but files were not.
//
// How it works:
//   1. Each document row stores pool_account_id (UUID from storage_pool).
//   2. We look up storage_pool.owner_username for that UUID.
//   3. uploadViaPool is called with uploadedBy = owner_username (e.g. 'P1').
//   4. gateway.selectPoolAccount() finds P1's connected Drive account.
//   5. The file is uploaded and the document row is patched with the new
//      gdrive_file_id / gdrive_url / pool_account_id / file_url.
//
// Cross-account support: each docEntry in the manifest can carry a different
// pool_account_id (uploaded by different users). We resolve owner_username
// per entry so every file goes back to its original owner's Drive.

import { createHash } from 'crypto'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { decryptBackupData, decryptDoubleEncryptedClassified, verifyChecksum } from './encryption'
import { uploadViaPool } from '@/lib/gdrive-pool/migrate-modal'
import { verifyManifestIntegrity, type BackupManifest } from './manifest'
import type { BackupModuleName } from './modules'
import { BACKUP_MODULES } from './modules'

// Modules whose primary table stores a direct Drive file reference
// (gdrive_file_id / gdrive_url / pool_account_id / file_url) on the document
// row itself. After re-uploading the file during recovery, these rows must
// be patched with the NEW reference — otherwise they keep pointing at a
// Drive file that no longer exists.
const MODULES_WITH_PATCHABLE_PRIMARY_FILE: BackupModuleName[] = [
  'master_documents',
  'admin_orders',
  'daily_journals',
  'e_library',
  'classified_documents',
]

// ── owner_username cache ──────────────────────────────────────────────────────
// Avoids repeated DB lookups when many files share the same pool account.
const ownerUsernameCache = new Map<string, string>()

/**
 * Resolves the owner_username for a pool_account_id UUID.
 * Returns null if the pool account no longer exists (deleted/disconnected).
 */
async function resolveOwnerUsername(
  poolAccountId: string | null | undefined
): Promise<string | null> {
  if (!poolAccountId) return null

  const cached = ownerUsernameCache.get(poolAccountId)
  if (cached) return cached

  const db = getServiceClient()
  const { data, error } = await db
    .from('storage_pool')
    .select('owner_username')
    .eq('id', poolAccountId)
    .maybeSingle()

  if (error || !data?.owner_username) {
    console.warn(
      `[Recovery] Could not resolve owner_username for pool_account_id="${poolAccountId}": ` +
      `${error?.message ?? 'row not found'}`
    )
    return null
  }

  ownerUsernameCache.set(poolAccountId, data.owner_username)
  return data.owner_username
}

// ── Module → primary table → Drive columns mapping ────────────────────────────
// Maps each module name to its primary document table so we can:
//   a) fetch the original pool_account_id stored on the document row
//   b) patch it with the new Drive reference after re-upload
const MODULE_PRIMARY_TABLE: Partial<Record<BackupModuleName, string>> = {
  master_documents:     'master_documents',
  admin_orders:         'special_orders',
  daily_journals:       'daily_journals',
  e_library:            'library_items',
  classified_documents: 'confidential_docs',
}

export interface RecoveryOptions {
  backup_job_id: string
  module_name:   BackupModuleName
  /**
   * The role/username that triggered the recovery.
   * Used only as a fallback uploadedBy when the document row has no
   * pool_account_id (pre-migration rows). Never used for file routing now.
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

  // Clear the owner_username cache for this recovery run
  ownerUsernameCache.clear()

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
    const manifestPath = `${backupJob.backup_folder_name}/MANIFEST.json`
    const manifestFile = zip.file(manifestPath)
    if (!manifestFile) {
      throw new Error(`MANIFEST.json not found in backup ZIP at path: ${manifestPath}`)
    }

    const manifestRaw         = await manifestFile.async('nodebuffer')
    const manifest            = JSON.parse(manifestRaw.toString('utf8')) as BackupManifest

    if (!verifyManifestIntegrity(manifest)) {
      throw new Error('Manifest integrity check failed — backup may be corrupted or tampered with.')
    }

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
    const useDoubleDecrypt = (moduleDef as any).extra_encryption === true

    for (const tableName of moduleDef.tables) {
      const tableData = await extractTableData(
        zip,
        tableName,
        backupJob.backup_folder_name,
        useDoubleDecrypt
      )
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

    // ── 6. Re-upload file attachments to Drive ────────────────────────────────
    //
    // KEY FIX: For each file, we look up the original pool_account_id from
    // the restored document row, resolve its owner_username from storage_pool,
    // and pass that as uploadedBy. This routes the upload to the correct user's
    // connected Drive account instead of failing with 'admin' (no Drive account).
    //
    let filesRestored = 0
    const primaryTable = MODULE_PRIMARY_TABLE[opts.module_name]

    if (manifest.contents?.attachments) {
      for (const docEntry of manifest.contents.attachments.files ?? []) {

        // ── 6a. Restore child attachment rows ──────────────────────────────
        for (const att of docEntry.attachments ?? []) {
          if (att.error) continue

          // Skip entries that are actually the primary file
          // (classified_documents stores the same path in both places)
          if (docEntry.main_file && att.file === docEntry.main_file) continue

          try {
            const fileBuffer = await extractFile(zip, att.file)
            if (!verifyChecksum(fileBuffer, att.checksum)) {
              console.warn(`[Recovery] Checksum mismatch for ${att.file} — skipping`)
              continue
            }

            // Resolve the correct uploader for this document
            const uploadedBy = await resolveUploaderForDocument(
              docEntry.document_id,
              primaryTable,
              triggeredBy,
              db
            )

            const def        = moduleDef as any
            const entityType = typeof def.entity_type === 'string' ? def.entity_type : undefined

            const result = await uploadViaPool({
              file:          fileBuffer,
              fileName:      att.file.split('/').pop()!,
              mimeType:      'application/octet-stream',
              category:      moduleDef.gdrive_category as any,
              entityType,
              entityId:      docEntry.document_id,
              uploadedBy,
              fileSizeBytes: fileBuffer.length,
            })

            console.log(
              `[Recovery] Restored attachment ${att.file} → ${result.fileUrl} ` +
              `(uploadedBy=${uploadedBy})`
            )
            filesRestored++
          } catch (err: any) {
            console.warn(`[Recovery] Could not restore attachment ${att.file}:`, err.message)
          }
        }

        // ── 6b. Restore PRIMARY file and re-link the document row ──────────
        //
        // The primary file is the main PDF stored directly on the document row
        // (gdrive_file_id / gdrive_url / pool_account_id on master_documents,
        // special_orders, daily_journals, library_items, confidential_docs).
        //
        // After re-uploading, we patch the row with the NEW Drive reference so
        // the app no longer points at the deleted original Drive file.
        //
        if (
          MODULES_WITH_PATCHABLE_PRIMARY_FILE.includes(opts.module_name) &&
          docEntry.main_file &&
          primaryTable
        ) {
          try {
            const fileBuffer = await extractFile(zip, docEntry.main_file)

            if (docEntry.main_checksum && !verifyChecksum(fileBuffer, docEntry.main_checksum)) {
              console.warn(
                `[Recovery] Checksum mismatch for primary file ${docEntry.main_file} — skipping`
              )
              continue
            }

            // Fetch the restored document row to get original pool_account_id
            const { data: docRow } = await db
              .from(primaryTable)
              .select('*')
              .eq('id', docEntry.document_id)
              .maybeSingle()

            // KEY FIX: resolve owner_username from the original pool_account_id
            // stored ON the document row (set when P1/P2/etc. originally uploaded it).
            // This ensures the file goes back to the same user's Drive account.
            const originalPoolId = (docRow as any)?.pool_account_id
            const uploadedBy = originalPoolId
              ? (await resolveOwnerUsername(originalPoolId) ?? triggeredBy)
              : triggeredBy

            if (!originalPoolId) {
              console.warn(
                `[Recovery] Document ${docEntry.document_id} in ${primaryTable} has no ` +
                `pool_account_id — falling back to triggeredBy="${triggeredBy}". ` +
                `This may fail if admin has no connected Drive account.`
              )
            } else {
              console.log(
                `[Recovery] Restoring primary file for doc ${docEntry.document_id}: ` +
                `pool_account_id=${originalPoolId} → owner_username=${uploadedBy}`
              )
            }

            const fileName = (docRow as any)?.file_name
              ?? docEntry.document_title
              ?? docEntry.main_file.split('/').pop()!
            const mimeType = (docRow as any)?.mime_type ?? 'application/pdf'

            const def        = moduleDef as any
            const entityType = typeof def.entity_type === 'string' ? def.entity_type : undefined

            const result = await uploadViaPool({
              file:          fileBuffer,
              fileName,
              mimeType,
              category:      moduleDef.gdrive_category as any,
              entityType,
              entityId:      docEntry.document_id,
              uploadedBy,
              fileSizeBytes: fileBuffer.length,
            })

            // Patch the document row with the NEW Drive reference.
            // Only patch columns that actually exist on this table —
            // confidential_docs has fewer Drive columns than the other modules.
            const patch: Record<string, any> = {}
            if (docRow && 'gdrive_file_id'  in docRow) patch.gdrive_file_id  = result.gdriveFileId
            if (docRow && 'gdrive_url'       in docRow) patch.gdrive_url      = result.fileUrl
            if (docRow && 'file_url'         in docRow) patch.file_url        = result.fileUrl
            if (docRow && 'pool_account_id'  in docRow) patch.pool_account_id = result.poolAccountId
            if (docRow && 'file_size_bytes'  in docRow) patch.file_size_bytes = fileBuffer.length
            if (docRow && 'mime_type'        in docRow) patch.mime_type       = mimeType
            if (docRow && 'file_name'        in docRow) patch.file_name       = fileName

            if (Object.keys(patch).length === 0) {
              console.warn(
                `[Recovery] No patchable Drive columns found on ${primaryTable} ` +
                `for ${docEntry.document_id} — skipping patch.`
              )
              filesRestored++
              continue
            }

            const { error: patchErr } = await db
              .from(primaryTable)
              .update(patch)
              .eq('id', docEntry.document_id)

            if (patchErr) {
              console.warn(
                `[Recovery] Uploaded primary file but failed to patch ${primaryTable}: ` +
                `${patchErr.message}`
              )
            } else {
              console.log(
                `[Recovery] Restored primary file for ${docEntry.document_id} → ` +
                `${result.fileUrl} (uploadedBy=${uploadedBy}, ` +
                `newPoolAccountId=${result.poolAccountId})`
              )
              filesRestored++
            }
          } catch (err: any) {
            console.warn(
              `[Recovery] Could not restore primary file for ${docEntry.document_id}:`,
              err.message
            )
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolves the correct uploadedBy username for a document.
 *
 * Priority:
 *   1. pool_account_id on the restored document row → owner_username
 *   2. uploaded_by column on the document row (if present)
 *   3. triggeredBy fallback (last resort — may fail if admin has no Drive)
 *
 * This ensures each file goes back to the Drive account of the user who
 * originally uploaded it, not the admin who triggered the recovery.
 */
async function resolveUploaderForDocument(
  documentId:    string,
  primaryTable:  string | undefined,
  triggeredBy:   string,
  db:            ReturnType<typeof getServiceClient>
): Promise<string> {
  if (!primaryTable) return triggeredBy

  try {
    const { data: docRow } = await db
      .from(primaryTable)
      .select('pool_account_id, uploaded_by')
      .eq('id', documentId)
      .maybeSingle()

    // Try pool_account_id first (most reliable — always set by the gateway)
    const poolId = (docRow as any)?.pool_account_id
    if (poolId) {
      const owner = await resolveOwnerUsername(poolId)
      if (owner) return owner
    }

    // Fall back to uploaded_by column
    const uploadedBy = (docRow as any)?.uploaded_by
    if (uploadedBy) return uploadedBy
  } catch (err: any) {
    console.warn(
      `[Recovery] Could not resolve uploader for doc ${documentId}: ${err.message}`
    )
  }

  return triggeredBy
}

// ── ZIP helpers ───────────────────────────────────────────────────────────────

async function loadBackupZip(downloadUrl: string): Promise<any> {
  const JSZip = (await import('jszip')).default

  const response = await fetch(downloadUrl)
  if (!response.ok) {
    throw new Error(
      `Failed to download backup ZIP (${response.status}): ${response.statusText}`
    )
  }

  const arrayBuffer = await response.arrayBuffer()
  return JSZip.loadAsync(arrayBuffer)
}

async function extractTableData(
  zip:              any,
  tableName:        string,
  folderName:       string,
  useDoubleDecrypt: boolean = false
): Promise<any[]> {
  const prefix  = `${folderName}/database/${tableName}_`
  const entries = Object.keys(zip.files).filter(
    name => name.startsWith(prefix) && !zip.files[name].dir
  )

  if (entries.length === 0) return []

  const file      = zip.file(entries[0])
  const rawBuffer = Buffer.from(await file.async('arraybuffer'))

  if (entries[0].endsWith('.enc')) {
    const decrypted = useDoubleDecrypt
      ? await decryptDoubleEncryptedClassified(rawBuffer)
      : await decryptBackupData(rawBuffer)
    return JSON.parse(decrypted.toString('utf8'))
  }

  return JSON.parse(rawBuffer.toString('utf8'))
}

async function extractFile(zip: any, relativePath: string): Promise<Buffer> {
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
  const snapshot: Record<string, any[]> = {}

  for (const tableName of moduleDef.tables) {
    const { data } = await db.from(tableName).select('*')
    snapshot[tableName] = data ?? []
  }

  const snapshotId = `rollback_${module_name}_${Date.now()}`

  const { error } = await db.from('backup_snapshots').insert({
    snapshot_id:   snapshotId,
    module_name,
    snapshot_data: snapshot,
    created_at:    new Date().toISOString(),
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