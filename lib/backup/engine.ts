// lib/backup/engine.ts
// Dev mode additions marked with [DEV MODE].
// Everything else is identical to the production engine.
//
// To test locally: set BACKUP_DEV_MODE=true in .env.local
// Drive downloads are skipped; ZIP is saved to /tmp instead of Supabase Storage.
//
// FIX: Primary files (gdrive_file_id stored directly on document rows) are now
// downloaded during backup and included in the manifest as `main_file` entries.
// Recovery re-uploads them and patches the document row with the new Drive reference.

import { createHash } from 'crypto'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { getDriveClient } from '@/lib/gdrive-pool/drive-client'
import { BACKUP_MODULES, type BackupModuleName } from './modules'
import { encryptBackupData, doubleEncryptClassified } from './encryption'
import { generateManifest, finalizeManifest } from './manifest'
import { exportAdminLogsAsXlsx } from './exporters/logs-exporter'
import { notifyBackupResult } from './notifications'
import {
  DEV_MODE,
  logDevModeStatus,
  devModeAttachmentPlaceholder,
  devModeSaveZip,
} from './dev-mode'

// [DEV MODE] Log once when the module is first imported
logDevModeStatus()

export interface BackupRunOptions {
  jobId:       string
  module_name: BackupModuleName
  backup_type: 'full' | 'incremental' | 'differential' | 'manual'
}

export interface BackupResult {
  success:          boolean
  jobId:            string
  folderName:       string
  fileCount:        number
  totalBytes:       number
  durationSecs:     number
  manifestChecksum: string
  error?:           string
}

// Modules that store a primary file directly on the document row
// (gdrive_file_id column on the main table, not just in attachment tables)
const MODULES_WITH_PRIMARY_FILES: BackupModuleName[] = [
  'master_documents',
  'admin_orders',
  'daily_journals',
  'e_library',
]

// ── FIX-1: resolve date range for admin_logs ──────────────────────────────────
function resolveLogsDateRange(
  backup_type: string,
  frequency:   string,
  now:         Date
): { fromDate: Date; label: string } {
  switch (frequency) {
    case 'yearly':
      return { fromDate: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000), label: 'last 365 days' }
    case 'monthly':
      return { fromDate: new Date(now.getTime() - 31  * 24 * 60 * 60 * 1000), label: 'last 31 days' }
    case 'weekly':
      return { fromDate: new Date(now.getTime() - 7   * 24 * 60 * 60 * 1000), label: 'last 7 days' }
  }
  switch (backup_type) {
    case 'full':
    case 'manual':
      return { fromDate: new Date(0), label: 'all time' }
    case 'incremental':
    case 'differential':
      return { fromDate: new Date(now.getTime() - 24 * 60 * 60 * 1000), label: 'last 24 hours' }
    default:
      return { fromDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), label: 'last 30 days' }
  }
}

// ── FIX-2: archived_files per-table export ────────────────────────────────────
async function exportArchivedTables(now: Date): Promise<Map<string, Buffer>> {
  const db    = getServiceClient()
  const files = new Map<string, Buffer>()

  for (const tableName of ['master_documents', 'daily_journals', 'library_items']) {
    const allRows: any[] = []
    let offset = 0
    while (true) {
      const { data, error } = await db
        .from(tableName).select('*').eq('archived', true)
        .range(offset, offset + 999)
      if (error) throw new Error(`Export archived ${tableName}: ${error.message}`)
      if (!data || data.length === 0) break
      allRows.push(...data)
      if (data.length < 1000) break
      offset += 1000
    }
    if (allRows.length > 0) {
      const encrypted = await encryptBackupData(Buffer.from(JSON.stringify(allRows, null, 2)))
      files.set(`database/${tableName}_archived_${timestamp(now)}.json.enc`, encrypted)
    }
  }

  {
    const allRows: any[] = []
    let offset = 0
    while (true) {
      const { data, error } = await db
        .from('special_orders').select('*').eq('status', 'ARCHIVED')
        .range(offset, offset + 999)
      if (error) throw new Error(`Export archived special_orders: ${error.message}`)
      if (!data || data.length === 0) break
      allRows.push(...data)
      if (data.length < 1000) break
      offset += 1000
    }
    if (allRows.length > 0) {
      const encrypted = await encryptBackupData(Buffer.from(JSON.stringify(allRows, null, 2)))
      files.set(`database/special_orders_archived_${timestamp(now)}.json.enc`, encrypted)
    }
  }

  return files
}

/**
 * Downloads the primary file (gdrive_file_id on the document row itself) for each
 * document in modules that store a direct file reference. Pushes entries into
 * attachmentManifest so recovery can find and re-upload them.
 *
 * This is separate from downloadAttachments() which handles child rows in the
 * *_attachments tables. A document can have both a primary file AND attachments.
 */
async function downloadPrimaryFiles(params: {
  module_name:        BackupModuleName
  moduleDef:          any
  backupFiles:        Map<string, Buffer>
  attachmentManifest: any[]
  now:                Date
}): Promise<void> {
  const { module_name, moduleDef, backupFiles, attachmentManifest, now } = params
  const db          = getServiceClient()
  const primaryTable = moduleDef.tables[0]  // e.g. 'master_documents'

  const { data: docRows, error } = await db
    .from(primaryTable)
    .select('id, gdrive_file_id, pool_account_id, file_name, mime_type')
    .not('gdrive_file_id', 'is', null)

  if (error) {
    console.warn(`[Backup] Could not fetch primary file rows for ${primaryTable}: ${error.message}`)
    return
  }

  if (!docRows || docRows.length === 0) {
    console.log(`[Backup] No primary files found in ${primaryTable}`)
    return
  }

  console.log(`[Backup] Downloading ${docRows.length} primary file(s) from ${primaryTable}`)

  for (const doc of docRows) {
    try {
      let fileBuffer: Buffer

      if (DEV_MODE) {
        console.log(`[DevMode] Skipping Drive download for primary file doc ${doc.id} (${doc.file_name ?? 'unnamed'})`)
        fileBuffer = devModeAttachmentPlaceholder(doc.file_name ?? doc.id)
      } else {
        const drive    = await getDriveClient(doc.pool_account_id)
        const response = await drive.files.get(
          { fileId: doc.gdrive_file_id, alt: 'media' },
          { responseType: 'arraybuffer' }
        )
        fileBuffer = Buffer.from(response.data as ArrayBuffer)
      }

      const safeFileName = sanitizeFileName(doc.file_name ?? `${doc.id}.pdf`)
      const filePath     = `primary_files/${doc.id}/${safeFileName}`
      backupFiles.set(filePath, fileBuffer)

      const checksum = createHash('sha256').update(fileBuffer).digest('hex')

      // Push into attachmentManifest — recovery iterates this list to restore files
      attachmentManifest.push({
        document_id:    doc.id,
        document_title: doc.file_name ?? doc.id,
        main_file:      filePath,
        main_checksum:  checksum,
        // Carry the Drive metadata so recovery knows what it is restoring
        gdrive_file_id: doc.gdrive_file_id,
        pool_account_id: doc.pool_account_id,
        mime_type:      doc.mime_type ?? 'application/pdf',
        attachments:    [],
      })

      console.log(`[Backup] Primary file backed up: ${filePath} (${fileBuffer.length} bytes)`)
    } catch (err: any) {
      console.warn(`[Backup] Could not download primary file for doc ${doc.id}:`, err.message)
      // Push a stub so the manifest still references this doc (recovery will skip on error flag)
      attachmentManifest.push({
        document_id:    doc.id,
        document_title: doc.file_name ?? doc.id,
        main_file:      null,
        main_checksum:  null,
        error:          err.message,
        attachments:    [],
      })
    }
  }
}

/**
 * Runs a complete backup for a single module.
 */
export async function runModuleBackup(opts: BackupRunOptions): Promise<BackupResult> {
  const db    = getServiceClient()
  const start = Date.now()
  const { jobId, module_name, backup_type } = opts
  const moduleDef = BACKUP_MODULES[module_name]

  const { data: jobRow } = await db
    .from('backup_jobs').select('frequency').eq('id', jobId).maybeSingle()
  const frequency: string = (jobRow as any)?.frequency ?? 'manual'

  await db.from('backup_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', jobId)

  try {
    const now        = new Date()
    const folderName = buildFolderName(now, module_name)
    const backupFiles: Map<string, Buffer> = new Map()

    // ── 1. Export database records ────────────────────────────────────────────
    console.log(`[Backup] Exporting database for module: ${module_name}`)

    if (module_name === 'admin_logs') {
      const { fromDate, label } = resolveLogsDateRange(backup_type, frequency, now)
      console.log(`[Backup] admin_logs date range: ${label}`)
      const xlsxBuf = await exportAdminLogsAsXlsx(fromDate, now)
      backupFiles.set(`database/admin_logs_${timestamp(now)}.xlsx`, xlsxBuf)

    } else if (module_name === 'archived_files') {
      const archivedFiles = await exportArchivedTables(now)
      for (const [path, buf] of archivedFiles) backupFiles.set(path, buf)

    } else {
      for (const tableName of moduleDef.tables) {
        const records = await exportTable(tableName, moduleDef)
        const json    = JSON.stringify(records, null, 2)

        const encrypted = (moduleDef as any).extra_encryption
          ? await doubleEncryptClassified(Buffer.from(json))
          : await encryptBackupData(Buffer.from(json))

        backupFiles.set(`database/${tableName}_${timestamp(now)}.json.enc`, encrypted)
      }
    }

    // ── 2. Download file attachments ──────────────────────────────────────────
    let attachmentManifest: any[] = []

    if (module_name !== 'archived_files') {
      if ((moduleDef as any).attachment_table && (moduleDef as any).attachment_fk) {
        attachmentManifest = await downloadAttachments({ module_name, moduleDef, backupFiles, now })
      } else if ((moduleDef as any).gdrive_category) {
        attachmentManifest = await downloadFromRecordsTable({ module_name, moduleDef, backupFiles, now })
      }
    }

    // ── 2b. Download PRIMARY files stored directly on document rows ───────────
    // These are separate from attachment_table rows — they are the main PDF/file
    // stored as gdrive_file_id on the document row itself (e.g. master_documents.gdrive_file_id).
    // Without this step, deleting a document from Drive means recovery cannot
    // restore the actual file even though the DB row comes back.
    if (MODULES_WITH_PRIMARY_FILES.includes(module_name)) {
      await downloadPrimaryFiles({
        module_name,
        moduleDef,
        backupFiles,
        attachmentManifest,
        now,
      })
    }

    // ── 3. Generate manifest ──────────────────────────────────────────────────
    const manifest = await generateManifest({
      jobId, module_name, backup_type, folderName, backupFiles, attachmentManifest, now,
    })

    const durationSecs  = Math.round((Date.now() - start) / 1000)
    const finalManifest = finalizeManifest(manifest, durationSecs)
    backupFiles.set('MANIFEST.json', Buffer.from(JSON.stringify(finalManifest, null, 2)))

    // ── 4. Backup log ─────────────────────────────────────────────────────────
    const logContent = generateBackupLog({ jobId, module_name, fileCount: backupFiles.size, now })
    backupFiles.set(`logs/backup_log_${timestamp(now)}.txt`, Buffer.from(logContent))

    // ── 5. Package as ZIP ─────────────────────────────────────────────────────
    const zipBlob = await packageAsZip(folderName, backupFiles)

    const manifestBuf      = backupFiles.get('MANIFEST.json')!
    const manifestChecksum = createHash('sha256').update(manifestBuf).digest('hex')
    const totalBytes       = Array.from(backupFiles.values()).reduce((s, b) => s + b.length, 0)

    // ── 6. Store ZIP ──────────────────────────────────────────────────────────
    // [DEV MODE] writes to /tmp instead of Supabase Storage
    let downloadUrl: string

    if (DEV_MODE) {
      console.log(`[DevMode] Skipping Supabase Storage upload for job ${jobId}`)
      downloadUrl = await devModeSaveZip(folderName, zipBlob)
    } else {
      downloadUrl = await storeBackupBlob(jobId, folderName, zipBlob)
    }

    // ── 7. Update job record ──────────────────────────────────────────────────
    await db.from('backup_jobs').update({
      status:             'completed',
      completed_at:       new Date().toISOString(),
      duration_seconds:   durationSecs,
      backup_folder_name: folderName,
      file_count:         backupFiles.size,
      total_size_bytes:   totalBytes,
      manifest_checksum:  manifestChecksum,
      download_url:       downloadUrl,
    }).eq('id', jobId)

    // ── 8. Notify ─────────────────────────────────────────────────────────────
    await notifyBackupResult({ jobId, module_name, success: true, folderName, durationSecs, totalBytes })

    return { success: true, jobId, folderName, fileCount: backupFiles.size, totalBytes, durationSecs, manifestChecksum }

  } catch (err: any) {
    const msg = err?.message ?? String(err)
    console.error(`[Backup] Job ${jobId} FAILED:`, msg)

    await db.from('backup_jobs').update({
      status: 'failed', completed_at: new Date().toISOString(), error_message: msg,
    }).eq('id', jobId)

    await notifyBackupResult({ jobId, module_name, success: false, error: msg })

    return {
      success: false, jobId, folderName: '', fileCount: 0, totalBytes: 0,
      durationSecs: Math.round((Date.now() - start) / 1000), manifestChecksum: '', error: msg,
    }
  }
}

// ── Helper: export all rows from a Supabase table ─────────────────────────────
async function exportTable(tableName: string, moduleDef: any): Promise<any[]> {
  const db       = getServiceClient()
  const allRows: any[] = []
  let offset = 0

  while (true) {
    let query = db.from(tableName).select('*').range(offset, offset + 999)
    if (moduleDef.filter) {
      Object.entries(moduleDef.filter).forEach(([key, value]) => {
        query = query.eq(key, value as any)
      })
    }
    const { data, error } = await query
    if (error) throw new Error(`Export table ${tableName}: ${error.message}`)
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < 1000) break
    offset += 1000
  }
  return allRows
}

// ── Helper: download attachments from Drive ───────────────────────────────────
async function downloadAttachments(params: {
  module_name: string; moduleDef: any; backupFiles: Map<string, Buffer>; now: Date
}): Promise<any[]> {
  const { moduleDef, backupFiles } = params
  const db = getServiceClient()
  const attachmentManifest: any[] = []

  const { data: attachments } = await db.from(moduleDef.attachment_table).select('*')
  if (!attachments) return []

  const byDocument = new Map<string, any[]>()
  for (const att of attachments) {
    const docId = att[moduleDef.attachment_fk]
    if (!byDocument.has(docId)) byDocument.set(docId, [])
    byDocument.get(docId)!.push(att)
  }

  for (const [docId, atts] of byDocument) {
    const docEntry: any = { document_id: docId, attachments: [] }

    for (const att of atts) {
      try {
        let fileBuffer: Buffer

        // [DEV MODE] skip actual Drive API call
        if (DEV_MODE) {
          console.log(`[DevMode] Skipping Drive download for attachment ${att.id} (${att.file_name ?? 'unnamed'})`)
          fileBuffer = devModeAttachmentPlaceholder(att.file_name ?? att.id)
        } else {
          const drive    = await getDriveClient(att.pool_account_id)
          const response = await drive.files.get(
            { fileId: att.gdrive_file_id, alt: 'media' },
            { responseType: 'arraybuffer' }
          )
          fileBuffer = Buffer.from(response.data as ArrayBuffer)
        }

        const safeFileName = sanitizeFileName(att.file_name || `file_${att.id}`)
        const filePath     = `attachments/${docId}/attachments/${att.id}_${safeFileName}`
        backupFiles.set(filePath, fileBuffer)

        const checksum = createHash('sha256').update(fileBuffer).digest('hex')
        docEntry.attachments.push({
          attachment_id: att.id, title: att.title, file: filePath,
          checksum, size_bytes: fileBuffer.length,
          dev_mode_placeholder: DEV_MODE || undefined,
          pool_account_id: att.pool_account_id,
        })
      } catch (err: any) {
        console.warn(`[Backup] Could not download attachment ${att.id}:`, err.message)
        docEntry.attachments.push({ attachment_id: att.id, error: err.message, pool_account_id: att.pool_account_id,  })
      }
    }
    attachmentManifest.push(docEntry)
  }
  return attachmentManifest
}

// ── Helper: download from records table ──────────────────────────────────────

// ── Helper: download from records table ──────────────────────────────────────
async function downloadFromRecordsTable(params: {
  module_name: string; moduleDef: any; backupFiles: Map<string, Buffer>; now: Date
}): Promise<any[]> {
  const { moduleDef, backupFiles } = params
  const db = getServiceClient()
  const manifest: any[] = []

  const { data: records } = await db
    .from('records').select('*')
    .eq('category', moduleDef.gdrive_category).eq('is_accessible', true)
  if (!records) return []

  for (const record of records) {
    const docId = record.entity_id ?? record.id

    try {
      let fileBuffer: Buffer

      // [DEV MODE] skip actual Drive API call
      if (DEV_MODE) {
        console.log(`[DevMode] Skipping Drive download for record ${record.id} (${record.file_name})`)
        fileBuffer = devModeAttachmentPlaceholder(record.file_name)
      } else {
        const drive    = await getDriveClient(record.pool_account_id)
        const response = await drive.files.get(
          { fileId: record.gdrive_file_id, alt: 'media' },
          { responseType: 'arraybuffer' }
        )
        fileBuffer = Buffer.from(response.data as ArrayBuffer)
      }

      const safeFileName = sanitizeFileName(record.file_name)
      const filePath      = `attachments/${docId}/main_${safeFileName}`
      backupFiles.set(filePath, fileBuffer)

      const checksum = createHash('sha256').update(fileBuffer).digest('hex')

      // FIX: wrap as a "folder" object (document_id + attachments[]) instead of
      // a flat { record_id, file, checksum } object. manifest.ts always expects
      // a folder with an attachments array inside it — handing it a loose paper
      // crashed with "Cannot read properties of undefined (reading 'map')".
      manifest.push({
        document_id:    docId,
        document_title: record.file_name,
        main_file:      filePath,
        main_checksum:  checksum,
        attachments: [{
          attachment_id: record.id,
          title:         record.file_name,
          file:          filePath,
          checksum,
        }],
      })
    } catch (err: any) {
      console.warn(`[Backup] Could not download record ${record.id}:`, err.message)

      // FIX: still record the failure inside a folder (with `error` set on the
      // attachment) instead of silently dropping it. recovery.ts checks
      // att.error to skip broken files — it needs this entry to exist.
      manifest.push({
        document_id:    docId,
        document_title: record.file_name,
        main_file:      '',
        main_checksum:  '',
        attachments: [{
          attachment_id: record.id,
          title:         record.file_name,
          file:          '',
          checksum:      '',
          error:         err.message,
        }],
      })
    }
  }
  return manifest
}

// ── Helper: store ZIP to Supabase Storage ─────────────────────────────────────
async function storeBackupBlob(jobId: string, folderName: string, blob: Blob): Promise<string> {
  const db          = getServiceClient()
  const arrayBuffer = await blob.arrayBuffer()
  const buffer      = Buffer.from(arrayBuffer)
  const storagePath = `${folderName}/${jobId}.zip`

  const { error: uploadError } = await db.storage
    .from('backup-staging')
    .upload(storagePath, buffer, { contentType: 'application/zip', upsert: true })

  if (uploadError) {
    throw new Error(
      `Failed to store backup ZIP to Supabase Storage bucket "backup-staging": ${uploadError.message}. ` +
      `Create the bucket in Supabase Dashboard → Storage, or set BACKUP_DEV_MODE=true to skip this step during development.`
    )
  }

  const { data: signedData, error: signedError } = await db.storage
    .from('backup-staging')
    .createSignedUrl(storagePath, 60 * 60)

  if (signedError || !signedData?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${signedError?.message ?? 'unknown'}`)
  }

  return signedData.signedUrl
}

// ── Helper: package files as ZIP ──────────────────────────────────────────────
async function packageAsZip(folderName: string, files: Map<string, Buffer>): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip   = new JSZip()
  const root  = zip.folder(folderName)!

  for (const [path, buffer] of files) {
    const parts    = path.split('/')
    const fileName = parts.pop()!
    let folder     = root
    for (const part of parts) folder = folder.folder(part) ?? folder
    folder.file(fileName, buffer)
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildFolderName(date: Date, module_name: string): string {
  const pad    = (n: number) => n.toString().padStart(2, '0')
  const year   = date.getFullYear()
  const month  = pad(date.getMonth() + 1)
  const day    = pad(date.getDate())
  const hour   = date.getHours()
  const min    = pad(date.getMinutes())
  const h12    = pad(hour % 12 || 12)
  const ampm   = hour >= 12 ? 'PM' : 'AM'
  const label  = module_name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  return `Backup_${year}-${month}-${day}_${h12}-${min}-${ampm}_${label}`
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z'
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-]/g, '_')
}

function generateBackupLog(params: { jobId: string; module_name: string; fileCount: number; now: Date }): string {
  const { jobId, module_name, fileCount, now } = params
  return [
    `PNP DNPPO Records Management System`,
    `Backup Operation Log`,
    `=====================================`,
    `Job ID:     ${jobId}`,
    `Module:     ${module_name}`,
    `Timestamp:  ${now.toISOString()}`,
    `Files:      ${fileCount}`,
    `Dev Mode:   ${DEV_MODE}`,
    `Status:     COMPLETED`,
    `=====================================`,
    `End of log`,
  ].join('\n')
}

export async function runScheduledBackup(opts: {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  triggeredBy: string
}): Promise<{ started: number; results: BackupResult[] }> {
  const db = getServiceClient()
  const { data: configs } = await db
    .from('backup_configs').select('*').eq('is_enabled', true).eq('frequency', opts.frequency)

  if (!configs || configs.length === 0) {
    console.log(`[Backup] No enabled configs for frequency: ${opts.frequency}`)
    return { started: 0, results: [] }
  }

  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const { data: job } = await db
        .from('backup_jobs')
        .insert({
          config_id: config.id, module_name: config.module_name,
          backup_type: config.backup_type, frequency: opts.frequency,
          status: 'pending', triggered_by: opts.triggeredBy,
        })
        .select().single()

      return runModuleBackup({
        jobId: job!.id, module_name: config.module_name as BackupModuleName,
        backup_type: config.backup_type,
      })
    })
  )

  const settled = results.map(r =>
    r.status === 'fulfilled' ? r.value : { success: false } as BackupResult
  )

  return { started: configs.length, results: settled }
}