// lib/backup/engine.ts

import { createHash } from 'crypto'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { getDriveClient } from '@/lib/gdrive-pool/drive-client'
import { BACKUP_MODULES, type BackupModuleName } from './modules'
import { encryptBackupData, doubleEncryptClassified } from './encryption'
import { generateManifest, finalizeManifest } from './manifest'
import { exportAdminLogsAsXlsx } from './exporters/logs-exporter'
import { notifyBackupResult } from './notifications'

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

/**
 * Runs a complete backup for a single module.
 * Downloads database records + all file attachments from Google Drive.
 * Packages everything as a ZIP and stores it to Supabase Storage.
 */
export async function runModuleBackup(opts: BackupRunOptions): Promise<BackupResult> {
  const db = getServiceClient()
  const start = Date.now()
  const { jobId, module_name, backup_type } = opts
  const moduleDef = BACKUP_MODULES[module_name]

  // Update job status to running
  await db
    .from('backup_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', jobId)

  try {
    const now = new Date()
    const folderName = buildFolderName(now, module_name)
    const backupFiles: Map<string, Buffer> = new Map()

    // ── 1. Export database records ──────────────────────────────────────────
    console.log(`[Backup] Exporting database for module: ${module_name}`)

    if (module_name === 'admin_logs') {
      // Admin logs → XLSX (unencrypted; no sensitive PII, used for audit review)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const xlsxBuf = await exportAdminLogsAsXlsx(thirtyDaysAgo, now)
      backupFiles.set(`database/admin_logs_${timestamp(now)}.xlsx`, xlsxBuf)
    } else {
      for (const tableName of moduleDef.tables) {
        const records = await exportTable(tableName, moduleDef)
        const json = JSON.stringify(records, null, 2)

        // FIX: apply double-encryption for classified_documents
        const encrypted = (moduleDef as any).extra_encryption
          ? await doubleEncryptClassified(Buffer.from(json))
          : await encryptBackupData(Buffer.from(json))

        backupFiles.set(`database/${tableName}_${timestamp(now)}.json.enc`, encrypted)
      }
    }

    // ── 2. Download file attachments from Google Drive ──────────────────────
    let attachmentManifest: any[] = []

    if ((moduleDef as any).attachment_table && (moduleDef as any).attachment_fk) {
      console.log(`[Backup] Downloading attachments for ${module_name}`)
      attachmentManifest = await downloadAttachments({ module_name, moduleDef, backupFiles, now })
    } else if ((moduleDef as any).gdrive_category) {
      attachmentManifest = await downloadFromRecordsTable({ module_name, moduleDef, backupFiles, now })
    }

    // ── 3. Generate manifest ─────────────────────────────────────────────────
    const manifest = await generateManifest({
      jobId,
      module_name,
      backup_type,
      folderName,
      backupFiles,
      attachmentManifest,
      now,
    })

    // ── 4. Finalize manifest with real duration ───────────────────────────────
    // FIX: was never called before; duration was always 0 in the manifest.
    const durationSecs = Math.round((Date.now() - start) / 1000)
    const finalManifest = finalizeManifest(manifest, durationSecs)
    backupFiles.set('MANIFEST.json', Buffer.from(JSON.stringify(finalManifest, null, 2)))

    // ── 5. Generate backup log ───────────────────────────────────────────────
    const logContent = generateBackupLog({ jobId, module_name, fileCount: backupFiles.size, now })
    backupFiles.set(`logs/backup_log_${timestamp(now)}.txt`, Buffer.from(logContent))

    // ── 6. Package as ZIP ────────────────────────────────────────────────────
    const zipBlob = await packageAsZip(folderName, backupFiles)

    // ── 7. Compute manifest checksum ─────────────────────────────────────────
    const manifestBuf = backupFiles.get('MANIFEST.json')!
    const manifestChecksum = createHash('sha256').update(manifestBuf).digest('hex')

    const totalBytes = Array.from(backupFiles.values()).reduce((s, b) => s + b.length, 0)

    // ── 8. Store ZIP to Supabase Storage ─────────────────────────────────────
    // FIX: was a no-op stub; now actually uploads the ZIP.
    const downloadUrl = await storeBackupBlob(jobId, folderName, zipBlob)

    // ── 9. Update job record ─────────────────────────────────────────────────
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

    // ── 10. Notify ───────────────────────────────────────────────────────────
    await notifyBackupResult({
      jobId,
      module_name,
      success:     true,
      folderName,
      durationSecs,
      totalBytes,
    })

    return {
      success:          true,
      jobId,
      folderName,
      fileCount:        backupFiles.size,
      totalBytes,
      durationSecs,
      manifestChecksum,
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    console.error(`[Backup] Job ${jobId} FAILED:`, msg)

    await db.from('backup_jobs').update({
      status:        'failed',
      completed_at:  new Date().toISOString(),
      error_message: msg,
    }).eq('id', jobId)

    await notifyBackupResult({ jobId, module_name, success: false, error: msg })

    return {
      success:          false,
      jobId,
      folderName:       '',
      fileCount:        0,
      totalBytes:       0,
      durationSecs:     Math.round((Date.now() - start) / 1000),
      manifestChecksum: '',
      error:            msg,
    }
  }
}

// ── Helper: export all rows from a Supabase table ─────────────────────────────
async function exportTable(tableName: string, moduleDef: any): Promise<any[]> {
  const db = getServiceClient()
  const PAGE_SIZE = 1000
  const allRows: any[] = []
  let offset = 0

  while (true) {
    let query = db.from(tableName).select('*').range(offset, offset + PAGE_SIZE - 1)

    if (moduleDef.filter) {
      Object.entries(moduleDef.filter).forEach(([key, value]) => {
        query = query.eq(key, value as any)
      })
    }

    const { data, error } = await query
    if (error) throw new Error(`Export table ${tableName}: ${error.message}`)
    if (!data || data.length === 0) break

    allRows.push(...data)
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return allRows
}

// ── Helper: download attachments from Drive ───────────────────────────────────
async function downloadAttachments(params: {
  module_name: string
  moduleDef:   any
  backupFiles: Map<string, Buffer>
  now:         Date
}): Promise<any[]> {
  const { moduleDef, backupFiles } = params
  const db = getServiceClient()
  const attachmentManifest: any[] = []

  const { data: attachments } = await db
    .from(moduleDef.attachment_table)
    .select('*')

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
        const drive = await getDriveClient(att.pool_account_id)
        const response = await drive.files.get(
          { fileId: att.gdrive_file_id, alt: 'media' },
          { responseType: 'arraybuffer' }
        )

        const fileBuffer = Buffer.from(response.data as ArrayBuffer)
        const safeFileName = sanitizeFileName(att.file_name || `file_${att.id}`)
        const filePath = `attachments/${docId}/attachments/${att.id}_${safeFileName}`

        backupFiles.set(filePath, fileBuffer)

        const checksum = createHash('sha256').update(fileBuffer).digest('hex')
        docEntry.attachments.push({
          attachment_id: att.id,
          title:         att.title,
          file:          filePath,
          checksum,
          size_bytes:    fileBuffer.length,
        })
      } catch (err: any) {
        console.warn(`[Backup] Could not download attachment ${att.id}:`, err.message)
        docEntry.attachments.push({ attachment_id: att.id, error: err.message })
      }
    }

    attachmentManifest.push(docEntry)
  }

  return attachmentManifest
}

// ── Helper: download from records table (modules without attachment_table) ─────
async function downloadFromRecordsTable(params: {
  module_name: string
  moduleDef:   any
  backupFiles: Map<string, Buffer>
  now:         Date
}): Promise<any[]> {
  const { moduleDef, backupFiles } = params
  const db = getServiceClient()
  const manifest: any[] = []

  const { data: records } = await db
    .from('records')
    .select('*')
    .eq('category', moduleDef.gdrive_category)
    .eq('is_accessible', true)

  if (!records) return []

  for (const record of records) {
    try {
      const drive = await getDriveClient(record.pool_account_id)
      const response = await drive.files.get(
        { fileId: record.gdrive_file_id, alt: 'media' },
        { responseType: 'arraybuffer' }
      )

      const fileBuffer = Buffer.from(response.data as ArrayBuffer)
      const safeFileName = sanitizeFileName(record.file_name)
      const docId = record.entity_id ?? record.id
      const filePath = `attachments/${docId}/main_${safeFileName}`

      backupFiles.set(filePath, fileBuffer)

      const checksum = createHash('sha256').update(fileBuffer).digest('hex')
      manifest.push({ record_id: record.id, file: filePath, checksum, size_bytes: fileBuffer.length })
    } catch (err: any) {
      console.warn(`[Backup] Could not download record ${record.id}:`, err.message)
    }
  }

  return manifest
}

// ── Helper: store ZIP to Supabase Storage ────────────────────────────────────
/**
 * Uploads the backup ZIP to the 'backup-staging' Supabase Storage bucket.
 * Files expire after 1 hour via a signed URL; for permanent storage,
 * move to a long-lived bucket and remove the expiry.
 *
 * Returns the signed URL so the client can download the file.
 */
async function storeBackupBlob(
  jobId:      string,
  folderName: string,
  blob:       Blob
): Promise<string> {
  const db = getServiceClient()
  const arrayBuffer = await blob.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const storagePath = `${folderName}/${jobId}.zip`

  const { error: uploadError } = await db.storage
    .from('backup-staging')
    .upload(storagePath, buffer, {
      contentType: 'application/zip',
      upsert:      true,
    })

  if (uploadError) {
    throw new Error(`Failed to store backup ZIP: ${uploadError.message}`)
  }

  const { data: signedData, error: signedError } = await db.storage
    .from('backup-staging')
    .createSignedUrl(storagePath, 60 * 60) // 1-hour expiry

  if (signedError || !signedData?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${signedError?.message ?? 'unknown'}`)
  }

  return signedData.signedUrl
}

// ── Helper: package files as ZIP ─────────────────────────────────────────────
async function packageAsZip(folderName: string, files: Map<string, Buffer>): Promise<Blob> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const root = zip.folder(folderName)!

  for (const [path, buffer] of files) {
    const parts = path.split('/')
    const fileName = parts.pop()!
    let folder = root
    for (const part of parts) {
      folder = folder.folder(part) ?? folder
    }
    folder.file(fileName, buffer)
  }

  return zip.generateAsync({
    type:               'blob',
    compression:        'DEFLATE',
    compressionOptions: { level: 6 },
  })
}

// ── Helper: build folder name ─────────────────────────────────────────────────
function buildFolderName(date: Date, module_name: string): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const year  = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day   = pad(date.getDate())
  const hour  = date.getHours()
  const min   = pad(date.getMinutes())
  const ampm  = hour >= 12 ? 'PM' : 'AM'
  const h12   = pad(hour % 12 || 12)

  const moduleLabel = module_name
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')

  return `Backup_${year}-${month}-${day}_${h12}-${min}-${ampm}_${moduleLabel}`
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', 'T').slice(0, 19) + 'Z'
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\-]/g, '_')
}

function generateBackupLog(params: {
  jobId:       string
  module_name: string
  fileCount:   number
  now:         Date
}): string {
  const { jobId, module_name, fileCount, now } = params
  return [
    `PNP DNPPO Records Management System`,
    `Backup Operation Log`,
    `=====================================`,
    `Job ID:     ${jobId}`,
    `Module:     ${module_name}`,
    `Timestamp:  ${now.toISOString()}`,
    `Files:      ${fileCount}`,
    `Status:     COMPLETED`,
    `=====================================`,
    `End of log`,
  ].join('\n')
}

// ── Scheduled backup runner ───────────────────────────────────────────────────
/** Runs all enabled modules for a given frequency */
export async function runScheduledBackup(opts: {
  frequency:   'daily' | 'weekly' | 'monthly' | 'yearly'
  triggeredBy: string
}): Promise<{ started: number; results: BackupResult[] }> {
  const db = getServiceClient()

  const { data: configs } = await db
    .from('backup_configs')
    .select('*')
    .eq('is_enabled', true)
    .eq('frequency', opts.frequency)

  if (!configs || configs.length === 0) {
    console.log(`[Backup] No enabled configs for frequency: ${opts.frequency}`)
    return { started: 0, results: [] }
  }

  const results = await Promise.allSettled(
    configs.map(async (config) => {
      const { data: job } = await db
        .from('backup_jobs')
        .insert({
          config_id:    config.id,
          module_name:  config.module_name,
          backup_type:  config.backup_type,
          frequency:    opts.frequency,
          status:       'pending',
          triggered_by: opts.triggeredBy,
        })
        .select()
        .single()

      return runModuleBackup({
        jobId:       job!.id,
        module_name: config.module_name as BackupModuleName,
        backup_type: config.backup_type,
      })
    })
  )

  const settled = results.map(r =>
    r.status === 'fulfilled' ? r.value : { success: false } as BackupResult
  )

  return { started: configs.length, results: settled }
}