// lib/backup/manifest.ts
// Manifest file generator for DNPPO RMS Backup System
// Generates MANIFEST.json placed at the root of every backup folder

import { createHash } from 'crypto'
import type { BackupModuleName } from './modules'

// ── Constants ─────────────────────────────────────────────────────────────────

const RMS_VERSION       = '1.4.2'
const MANIFEST_VERSION  = '1.0'
const ENCRYPTION_ALGORITHM = 'AES-256-GCM'
const INTEGRITY_ALGORITHM  = 'SHA-256'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AttachmentEntry {
  attachment_id: string
  title:         string
  file:          string
  checksum:      string
}

export interface DocumentAttachmentGroup {
  document_id:    string
  document_title: string
  main_file:      string
  main_checksum:  string
  attachments:    AttachmentEntry[]
}

export interface ManifestDatabaseSection {
  table:           string
  record_count:    number
  file:            string
  checksum_sha256: string
}

export interface ManifestContents {
  database:    ManifestDatabaseSection | ManifestDatabaseSection[]
  attachments: {
    document_count:   number
    attachment_count: number
    total_size_bytes: number
    files:            DocumentAttachmentGroup[]
  }
}

export interface BackupManifest {
  manifest_version: string
  rms_version:      string
  backup_id:        string
  module:           BackupModuleName
  backup_type:      'full' | 'incremental' | 'differential' | 'manual'
  frequency:        'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'manual'
  created_at:       string
  created_by:       string
  environment:      string
  encryption: {
    algorithm: string
    key_id:    string
    encrypted: boolean
  }
  contents:  ManifestContents
  integrity: {
    manifest_checksum: string
    algorithm:         string
  }
  statistics: {
    total_files:      number
    total_size_bytes: number
    duration_seconds: number
  }
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface GenerateManifestOptions {
  jobId:              string
  module_name:        BackupModuleName
  backup_type:        'full' | 'incremental' | 'differential' | 'manual'
  frequency?:         'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'manual'
  folderName:         string
  backupFiles:        Map<string, Buffer>
  attachmentManifest: DocumentAttachmentGroup[]
  now:                Date
  triggeredBy?:       string
  /**
   * Record counts per table name, supplied by the engine after exporting.
   * If not provided, the manifest will still try to infer counts from the
   * JSON buffers in backupFiles (best-effort).
   */
  recordCounts?:      Record<string, number>
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateManifest(
  opts: GenerateManifestOptions
): Promise<BackupManifest> {
  const {
    jobId,
    module_name,
    backup_type,
    frequency = backup_type === 'manual' ? 'manual' : 'daily',
    backupFiles,
    attachmentManifest,
    now,
    triggeredBy  = 'scheduler',
    recordCounts = {},
  } = opts

  const databaseEntries   = buildDatabaseSections(module_name, backupFiles, recordCounts)
  const attachmentSection = buildAttachmentSection(attachmentManifest, backupFiles)
  const keyId             = deriveKeyId(now)

  const manifest: BackupManifest = {
    manifest_version: MANIFEST_VERSION,
    rms_version:      RMS_VERSION,
    backup_id:        jobId,
    module:           module_name,
    backup_type,
    frequency,
    created_at:       now.toISOString(),
    created_by:       triggeredBy,
    environment:      process.env.NODE_ENV ?? 'production',
    encryption: {
      algorithm: ENCRYPTION_ALGORITHM,
      key_id:    keyId,
      encrypted: true,
    },
    contents: {
      database:    databaseEntries.length === 1 ? databaseEntries[0] : (databaseEntries as any),
      attachments: attachmentSection,
    },
    integrity: {
      manifest_checksum: '',
      algorithm:         INTEGRITY_ALGORITHM,
    },
    statistics: {
      total_files:      backupFiles.size,
      total_size_bytes: totalSize(backupFiles),
      duration_seconds: 0, // filled in by finalizeManifest()
    },
  }

  manifest.integrity.manifest_checksum = computeManifestChecksum(manifest)
  return manifest
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds one ManifestDatabaseSection per database file in the backup.
 *
 * FIX: record_count is now populated from:
 *   1. The recordCounts map passed in from the engine (most accurate).
 *   2. Fallback: parse the JSON buffer to count rows (best-effort for
 *      cases where the engine didn't pass explicit counts).
 *   3. Last resort: 0 (matches old behaviour, but now clearly documented).
 */
function buildDatabaseSections(
  module_name:  BackupModuleName,
  backupFiles:  Map<string, Buffer>,
  recordCounts: Record<string, number>
): ManifestDatabaseSection[] {
  const sections: ManifestDatabaseSection[] = []

  for (const [relativePath, buffer] of backupFiles) {
    if (!relativePath.startsWith('database/')) continue

    const filename  = relativePath.replace('database/', '')
    const tableName = extractTableName(filename)

    // Try explicit count first, then parse the buffer, then fall back to 0
    let count = recordCounts[tableName] ?? 0
    if (count === 0 && filename.endsWith('.json.enc') === false) {
      // Only parseable if it's a plain JSON (not encrypted)
      try {
        const parsed = JSON.parse(buffer.toString('utf8'))
        if (Array.isArray(parsed)) count = parsed.length
      } catch {
        // Encrypted or malformed — leave as 0
      }
    }

    sections.push({
      table:           tableName,
      record_count:    count,
      file:            relativePath,
      checksum_sha256: sha256(buffer),
    })
  }

  if (sections.length === 0) {
    sections.push({
      table:           module_name,
      record_count:    0,
      file:            '',
      checksum_sha256: '',
    })
  }

  return sections
}

function buildAttachmentSection(
  attachmentManifest: DocumentAttachmentGroup[],
  backupFiles:        Map<string, Buffer>
): ManifestContents['attachments'] {
  let attachmentCount = 0
  let totalSizeBytes  = 0

  const files = attachmentManifest.map(group => {
    const mainBuf      = backupFiles.get(group.main_file)
    const mainChecksum = mainBuf ? sha256(mainBuf) : group.main_checksum
    if (mainBuf) totalSizeBytes += mainBuf.length

    const resolvedAttachments: AttachmentEntry[] = group.attachments.map(att => {
      attachmentCount++
      const attBuf = backupFiles.get(att.file)
      if (attBuf) totalSizeBytes += attBuf.length

      return {
        attachment_id: att.attachment_id,
        title:         att.title,
        file:          att.file,
        checksum:      attBuf ? sha256(attBuf) : att.checksum,
      }
    })

    return {
      document_id:    group.document_id,
      document_title: group.document_title,
      main_file:      group.main_file,
      main_checksum:  mainChecksum,
      attachments:    resolvedAttachments,
    }
  })

  return {
    document_count:   attachmentManifest.length,
    attachment_count: attachmentCount,
    total_size_bytes: totalSizeBytes,
    files,
  }
}

/**
 * Verifies a MANIFEST.json by recomputing its checksum and comparing.
 * Used during recovery to confirm the manifest hasn't been tampered with.
 */
export function verifyManifestIntegrity(manifest: BackupManifest): boolean {
  const storedChecksum = manifest.integrity.manifest_checksum
  const recomputed     = computeManifestChecksum(manifest)
  return recomputed === storedChecksum
}

/**
 * Updates duration_seconds and recomputes the manifest checksum.
 * Must be called by the engine after the backup completes, before writing
 * the final MANIFEST.json buffer to backupFiles.
 */
export function finalizeManifest(
  manifest:        BackupManifest,
  durationSeconds: number
): BackupManifest {
  manifest.statistics.duration_seconds = durationSeconds
  manifest.integrity.manifest_checksum = computeManifestChecksum(manifest)
  return manifest
}

// ── Utility ───────────────────────────────────────────────────────────────────

function computeManifestChecksum(manifest: BackupManifest): string {
  const withoutChecksum = JSON.stringify({
    ...manifest,
    integrity: { ...manifest.integrity, manifest_checksum: '' },
  })
  return sha256(Buffer.from(withoutChecksum))
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function totalSize(backupFiles: Map<string, Buffer>): number {
  return Array.from(backupFiles.values()).reduce((sum, buf) => sum + buf.length, 0)
}

function deriveKeyId(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm   = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `backup-key-${yyyy}-${mm}`
}

function extractTableName(filename: string): string {
  const cleaned = filename
    .replace(/\.json\.enc$/, '')
    .replace(/\.xlsx$/, '')
    .replace(/\.json$/, '')

  const match = cleaned.match(/^(.+?)_\d{4}-\d{2}-\d{2}/)
  return match ? match[1] : cleaned
}