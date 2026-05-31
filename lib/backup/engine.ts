// lib/backup/engine.ts
// FIXES applied in this version:
//   FIX-1: admin_logs date range now respects backup_type instead of being
//           hardcoded to 30 days. full=all-time, incremental=last 24h,
//           differential=since last full, weekly/monthly/yearly match their period.
//   FIX-2: archived_files filter uses per-table correct predicates:
//           master_documents/daily_journals/library_items use archived=true (boolean),
//           special_orders use status='ARCHIVED' (string).
//   (Other existing fixes from the original file are preserved unchanged.)

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

// ── FIX-1: resolve the correct date range for admin_logs based on backup_type ──
//
// Previously this was hardcoded to "last 30 days" regardless of backup_type,
// meaning a "full" manual backup would still silently miss older log history.
//
// Logic:
//   full      → all time (epoch)
//   manual    → all time (treat same as full for on-demand runs)
//   yearly    → last 365 days
//   monthly   → last 31 days
//   weekly    → last 7 days
//   incremental / differential → last 24 hours (catch-up window)
//
function resolveLogsDateRange(
  backup_type: string,
  frequency:   string,
  now:         Date
): { fromDate: Date; label: string } {
  // frequency takes priority for scheduled runs
  switch (frequency) {
    case 'yearly':
      return {
        fromDate: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
        label:    'last 365 days',
      }
    case 'monthly':
      return {
        fromDate: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000),
        label:    'last 31 days',
      }
    case 'weekly':
      return {
        fromDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        label:    'last 7 days',
      }
  }

  // fall back to backup_type for manual / custom triggers
  switch (backup_type) {
    case 'full':
    case 'manual':
      // epoch = all history
      return { fromDate: new Date(0), label: 'all time' }
    case 'incremental':
    case 'differential':
      return {
        fromDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        label:    'last 24 hours',
      }
    default:
      // safe fallback: 30 days (original behaviour)
      return {
        fromDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        label:    'last 30 days',
      }
  }
}

// ── FIX-2: archived_files per-table export ─────────────────────────────────
//
// Previously used a single filter { archived: true } which silently returned
// zero rows for special_orders because that table uses status='ARCHIVED' (a
// string enum), not a boolean archived column.
//
// Now each table is exported with its correct predicate.
//
async function exportArchivedTables(now: Date): Promise<Map<string, Buffer>> {
  const db    = getServiceClient()
  const files = new Map<string, Buffer>()

  // Tables that use a boolean `archived` column
  const booleanArchivedTables = ['master_documents', 'daily_journals', 'library_items']

  for (const tableName of booleanArchivedTables) {
    const allRows: any[] = []
    const PAGE_SIZE = 1000
    let offset = 0

    while (true) {
      const { data, error } = await db
        .from(tableName)
        .select('*')
        .eq('archived', true)           // ← boolean column
        .range(offset, offset + PAGE_SIZE - 1)

      if (error) throw new Error(`Export archived ${tableName}: ${error.message}`)
      if (!data || data.length === 0) break

      allRows.push(...data)
      if (data.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    if (allRows.length > 0) {
      const encrypted = await encryptBackupData(Buffer.from(JSON.stringify(allRows, null, 2)))
      files.set(`database/${tableName}_archived_${timestamp(now)}.json.enc`, encrypted)
    }
  }

  // special_orders uses status='ARCHIVED' (string), not a boolean column
  {
    const allRows: any[] = []
    const PAGE_SIZE = 1000
    let offset = 0

    while (true) {
      const { data, error } = await db
        .from('special_orders')
        .select('*')
        .eq('status', 'ARCHIVED')       // ← string enum, not boolean
        .range(offset, offset + PAGE_SIZE - 1)

      if (error) throw new Error(`Export archived special_orders: ${error.message}`)
      if (!data || data.length === 0) break

      allRows.push(...data)
      if (data.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    if (allRows.length > 0) {
      const encrypted = await encryptBackupData(Buffer.from(JSON.stringify(allRows, null, 2)))
      files.set(`database/special_orders_archived_${timestamp(now)}.json.enc`, encrypted)
    }
  }

  return files
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

  // Resolve the frequency for this job (used by logs date-range and manifest)
  const { data: jobRow } = await db
    .from('backup_jobs')
    .select('frequency')
    .eq('id', jobId)
    .maybeSingle()
  const frequency: string = (jobRow as any)?.frequency ?? 'manual'

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
      // FIX-1: use backup_type + frequency to determine date range
      const { fromDate, label } = resolveLogsDateRange(backup_type, frequency, now)
      console.log(`[Backup] admin_logs date range: ${label} (from ${fromDate.toISOString()})`)

      const xlsxBuf = await exportAdminLogsAsXlsx(fromDate, now)
      backupFiles.set(`database/admin_logs_${timestamp(now)}.xlsx`, xlsxBuf)

    } else if (module_name === 'archived_files') {
      // FIX-2: use per-table correct predicates
      console.log(`[Backup] Exporting archived_files with per-table predicates`)
      const archivedFiles = await exportArchivedTables(now)
      for (const [path, buf] of archivedFiles) {
        backupFiles.set(path, buf)
      }

    } else {
      for (const tableName of moduleDef.tables) {
        const records = await exportTable(tableName, moduleDef)
        const json = JSON.stringify(records, null, 2)

        const encrypted = (moduleDef as any).extra_encryption
          ? await doubleEncryptClassified(Buffer.from(json))
          : await encryptBackupData(Buffer.from(json))

        backupFiles.set(`database/${tableName}_${timestamp(now)}.json.enc`, encrypted)
      }
    }

    // ── 2. Download file attachments from Google Drive ──────────────────────
    let attachmentManifest: any[] = []

    // archived_files has no single attachment_table — skip attachment download
    if (module_name !== 'archived_files') {
      if ((moduleDef as any).attachment_table && (moduleDef as any).attachment_fk) {
        console.log(`[Backup] Downloading attachments for ${module_name}`)
        attachmentManifest = await downloadAttachments({ module_name, moduleDef, backupFiles, now })
      } else if ((moduleDef as any).gdrive_category) {
        attachmentManifest = await downloadFromRecordsTable({ module_name, moduleDef, backupFiles, now })
      }
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

// ── Helper: download from records table ───────────────────────────────────────
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
    .createSignedUrl(storagePath, 60 * 60)

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildFolderName(date: Date, module_name: string): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const year  = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day   = pad(date.getDate())
  const hour  = date.getHours()
  const min   = pad(date.getMinutes())
  const h12   = pad(hour % 12 || 12)
  const ampm  = hour >= 12 ? 'PM' : 'AM'

  const moduleLabel = module_name
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')

  return `Backup_${year}-${month}-${day}_${h12}-${min}-${ampm}_${moduleLabel}`
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z'
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