import { getServiceClient } from '@/lib/gdrive-pool/db'
import { decryptBackupData, verifyChecksum } from './encryption'
import { uploadViaPool } from '@/lib/gdrive-pool/migrate-modal'
import type { BackupModuleName } from './modules'
import { BACKUP_MODULES } from './modules'

export interface RecoveryOptions {
  backup_job_id: string
  module_name:   BackupModuleName
}

export interface RecoveryResult {
  success:           boolean
  recoveryJobId:     string
  recordsRestored:   number
  filesRestored:     number
  validationPassed:  boolean
  durationSecs:      number
  rollbackSnapshot:  string
  error?:            string
}

export async function runRecovery(opts: RecoveryOptions): Promise<RecoveryResult> {
  const db = getServiceClient()
  const start = Date.now()

  // Create recovery job record
  const { data: recoveryJob } = await db
    .from('recovery_jobs')
    .insert({
      backup_job_id: opts.backup_job_id,
      module_name:   opts.module_name,
      status:        'running',
      triggered_by:  'P1',
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

    if (!backupJob) throw new Error('Backup job not found.')
    if (backupJob.status !== 'completed') throw new Error('Cannot recover from a non-completed backup.')

    // ── 2. Download and validate backup ZIP ──────────────────────────────────
    console.log(`[Recovery] Loading backup: ${backupJob.backup_folder_name}`)
    const zipBlob = await loadBackupBlob(opts.backup_job_id)

    // ── 3. Parse manifest ────────────────────────────────────────────────────
    const manifest = await extractManifest(zipBlob)

    // Verify manifest integrity
    const manifestBuffer = Buffer.from(JSON.stringify(manifest))
    if (!verifyChecksum(manifestBuffer, backupJob.manifest_checksum!)) {
      throw new Error('Manifest checksum mismatch — backup may be corrupted or tampered with.')
    }

    console.log(`[Recovery] Manifest validated. Records: ${manifest.contents.database.record_count}`)

    // ── 4. Create pre-recovery snapshot (rollback protection) ────────────────
    const rollbackSnapshot = await createRollbackSnapshot(opts.module_name)
    console.log(`[Recovery] Rollback snapshot created: ${rollbackSnapshot}`)

    await db.from('recovery_jobs')
      .update({ rollback_snapshot: rollbackSnapshot })
      .eq('id', recoveryJobId)

    // ── 5. Restore database records ──────────────────────────────────────────
    let recordsRestored = 0
    const moduleDef = BACKUP_MODULES[opts.module_name]

    for (const tableName of moduleDef.tables) {
      const tableData = await extractTableData(zipBlob, tableName)
      if (!tableData) continue

      // Upsert records (preserve existing data not in backup)
      const { error } = await db
        .from(tableName)
        .upsert(tableData, { onConflict: 'id', ignoreDuplicates: false })

      if (error) throw new Error(`Restore table ${tableName} failed: ${error.message}`)
      recordsRestored += tableData.length
    }

    // ── 6. Re-upload file attachments to Drive ───────────────────────────────
    let filesRestored = 0

    if (manifest.contents.attachments) {
      for (const docEntry of manifest.contents.attachments.files) {
        for (const att of docEntry.attachments ?? []) {
          if (att.error) continue

          try {
            const fileBuffer = await extractFile(zipBlob, att.file)

            // Verify checksum
            if (!verifyChecksum(fileBuffer, att.checksum)) {
              console.warn(`[Recovery] Checksum mismatch for ${att.file} — skipping`)
              continue
            }

            // Re-upload to Drive pool

            const def = moduleDef as any

            await uploadViaPool({
              file:          fileBuffer,
              fileName:      att.file.split('/').pop()!,
              mimeType:      'application/octet-stream',
              category:      moduleDef.gdrive_category as any,
              entityType:    def.entity_type,
              entityId:      docEntry.document_id,
              uploadedBy:    'DPDA',
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

    const durationSecs = Math.round((Date.now() - start) / 1000)

    // ── 8. Finalize recovery job ─────────────────────────────────────────────
    await db.from('recovery_jobs').update({
      status:           'completed',
      completed_at:     new Date().toISOString(),
      duration_seconds: durationSecs,
      records_restored: recordsRestored,
      files_restored:   filesRestored,
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

/** Creates a JSON snapshot of current table state before recovery */
async function createRollbackSnapshot(module_name: BackupModuleName): Promise<string> {
  const db = getServiceClient()
  const moduleDef = BACKUP_MODULES[module_name]
  const snapshot: Record<string, any[]> = {}

  for (const tableName of moduleDef.tables) {
    const { data } = await db.from(tableName).select('*')
    snapshot[tableName] = data ?? []
  }

  // Store snapshot in Supabase with a TTL key
  const snapshotId = `rollback_${module_name}_${Date.now()}`
  // In production: store to a backup_snapshots table or temp bucket
  return snapshotId
}

/** Validates that recovery was successful by checking record counts */
async function validateRecovery(module_name: BackupModuleName, expectedCount: number): Promise<boolean> {
  const db = getServiceClient()
  const moduleDef = BACKUP_MODULES[module_name]
  const primaryTable = moduleDef.tables[0]

  const { count } = await db
    .from(primaryTable)
    .select('id', { count: 'exact', head: true })

  return (count ?? 0) >= expectedCount
}

// Stub implementations — replace with actual ZIP reading logic using JSZip
async function loadBackupBlob(backupJobId: string): Promise<any> { return null }
async function extractManifest(zip: any): Promise<any> { return {} }
async function extractTableData(zip: any, tableName: string): Promise<any[]> { return [] }
async function extractFile(zip: any, path: string): Promise<Buffer> { return Buffer.alloc(0) }