// lib/backup/manifest.ts
// Manifest file generator for DNPPO RMS Backup System
// Generates MANIFEST.json placed at the root of every backup folder

import { createHash } from 'crypto'
import type { BackupModuleName } from './modules'

// ── Constants ─────────────────────────────────────────────────────────────────

const RMS_VERSION = '1.4.2'
const MANIFEST_VERSION = '1.0'
const ENCRYPTION_ALGORITHM = 'AES-256-GCM'
const INTEGRITY_ALGORITHM = 'SHA-256'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AttachmentEntry {
  attachment_id: string
  title:         string
  file:          string            // relative path inside backup folder
  checksum:      string            // SHA-256 of the file buffer
}

export interface DocumentAttachmentGroup {
  document_id:    string
  document_title: string
  main_file:      string           // relative path
  main_checksum:  string
  attachments:    AttachmentEntry[]
}

export interface ManifestDatabaseSection {
  table:            string
  record_count:     number
  file:             string          // relative path
  checksum_sha256:  string
}

export interface ManifestContents {
  database:    ManifestDatabaseSection | ManifestDatabaseSection[]
  attachments: {
    document_count:    number
    attachment_count:  number
    total_size_bytes:  number
    files:             DocumentAttachmentGroup[]
  }
}

export interface BackupManifest {
  manifest_version: string
  rms_version:      string
  backup_id:        string
  module:           BackupModuleName
  backup_type:      'full' | 'incremental' | 'differential' | 'manual'
  frequency:        'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'manual'
  created_at:       string                  // ISO 8601
  created_by:       string                  // 'scheduler' | 'P1' | 'system'
  environment:      string
  encryption: {
    algorithm: string
    key_id:    string
    encrypted: boolean
  }
  contents:   ManifestContents
  integrity: {
    manifest_checksum: string               // SHA-256 of the manifest itself (computed after)
    algorithm:         string
  }
  statistics: {
    total_files:       number
    total_size_bytes:  number
    duration_seconds:  number
  }
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface GenerateManifestOptions {
  jobId:              string
  module_name:        BackupModuleName
  backup_type:        'full' | 'incremental' | 'differential' | 'manual'
  frequency?:         'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | 'manual'
  folderName:         string
  backupFiles:        Map<string, Buffer>   // relative path → file buffer
  attachmentManifest: DocumentAttachmentGroup[]
  now:                Date
  triggeredBy?:       string               // 'scheduler' | 'P1' | 'system'
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generates the MANIFEST.json content for a completed backup.
 *
 * Steps:
 *  1. Build database section(s) — one entry per .json.enc / .xlsx file
 *  2. Build attachments section from the attachment manifest
 *  3. Compute per-file SHA-256 checksums from backupFiles map
 *  4. Compute manifest integrity checksum (SHA-256 of the full JSON string)
 *  5. Return the fully typed BackupManifest object
 *
 * Usage (from engine.ts):
 *   const manifest = await generateManifest({ ... })
 *   backupFiles.set('MANIFEST.json', Buffer.from(JSON.stringify(manifest, null, 2)))
 */
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
    triggeredBy = 'scheduler',
  } = opts

  // ── 1. Build database section(s) ──────────────────────────────────────────
  const databaseEntries = buildDatabaseSections(module_name, backupFiles)

  // ── 2. Build attachment section ───────────────────────────────────────────
  const attachmentSection = buildAttachmentSection(attachmentManifest, backupFiles)

  // ── 3. Assemble manifest (without final checksum) ─────────────────────────
  const keyId = deriveKeyId(now)

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
      database:    databaseEntries.length === 1 ? databaseEntries[0] : databaseEntries as any,
      attachments: attachmentSection,
    },
    integrity: {
      manifest_checksum: '',   // placeholder — filled below
      algorithm:         INTEGRITY_ALGORITHM,
    },
    statistics: {
      total_files:      backupFiles.size,
      total_size_bytes: totalSize(backupFiles),
      duration_seconds: 0,     // engine fills this in after generateManifest returns
    },
  }

  // ── 4. Compute manifest checksum ─────────────────────────────────────────
  // Checksum is over the manifest content excluding the checksum field itself.
  const withoutChecksum = JSON.stringify({ ...manifest, integrity: { ...manifest.integrity, manifest_checksum: '' } })
  manifest.integrity.manifest_checksum = sha256(Buffer.from(withoutChecksum))

  return manifest
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds one ManifestDatabaseSection per database file in the backup.
 * Matches any file under "database/" prefix.
 */
function buildDatabaseSections(
  module_name: BackupModuleName,
  backupFiles: Map<string, Buffer>
): ManifestDatabaseSection[] {
  const sections: ManifestDatabaseSection[] = []

  for (const [relativePath, buffer] of backupFiles) {
    if (!relativePath.startsWith('database/')) continue

    // Derive table name from filename:
    // e.g. "database/master_documents_2026-05-16T02-00-00Z.json.enc" → "master_documents"
    const filename = relativePath.replace('database/', '')
    const tableName = extractTableName(filename)

    sections.push({
      table:           tableName,
      record_count:    0,    // caller should update this if known; or parse the file
      file:            relativePath,
      checksum_sha256: sha256(buffer),
    })
  }

  // Fallback: if no database files were found, return an empty placeholder
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

/**
 * Builds the attachments section.
 * Re-computes per-file checksums from the backupFiles map so they're always
 * consistent with the actual bytes that were written.
 */
function buildAttachmentSection(
  attachmentManifest: DocumentAttachmentGroup[],
  backupFiles: Map<string, Buffer>
): ManifestContents['attachments'] {
  let attachmentCount = 0
  let totalSizeBytes  = 0

  const files = attachmentManifest.map(group => {
    // Re-check main file checksum from actual buffer
    const mainBuf = backupFiles.get(group.main_file)
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

  const withoutChecksum = JSON.stringify({
    ...manifest,
    integrity: { ...manifest.integrity, manifest_checksum: '' },
  })

  const recomputed = sha256(Buffer.from(withoutChecksum))
  return recomputed === storedChecksum
}

/**
 * Updates the duration_seconds field after the backup engine finishes.
 * Call this just before writing the manifest buffer to backupFiles.
 */
export function finalizeManifest(
  manifest: BackupManifest,
  durationSeconds: number
): BackupManifest {
  manifest.statistics.duration_seconds = durationSeconds

  // Recompute checksum since duration changed
  const withoutChecksum = JSON.stringify({
    ...manifest,
    integrity: { ...manifest.integrity, manifest_checksum: '' },
  })
  manifest.integrity.manifest_checksum = sha256(Buffer.from(withoutChecksum))

  return manifest
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function totalSize(backupFiles: Map<string, Buffer>): number {
  return Array.from(backupFiles.values()).reduce((sum, buf) => sum + buf.length, 0)
}

/**
 * Derives a monthly key identifier hint (never the actual key).
 * Format: "backup-key-YYYY-MM"
 */
function deriveKeyId(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm   = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `backup-key-${yyyy}-${mm}`
}

/**
 * Extracts the table name from a database backup filename.
 * e.g. "master_documents_2026-05-16T02-00-00Z.json.enc" → "master_documents"
 *      "admin_logs_2026-05-16T02-00-00Z.xlsx"           → "admin_logs"
 */
function extractTableName(filename: string): string {
  // Strip common backup suffixes
  const cleaned = filename
    .replace(/\.json\.enc$/, '')
    .replace(/\.xlsx$/, '')
    .replace(/\.json$/, '')

  // The timestamp starts with an ISO date pattern: _YYYY-MM-DD or _YYYY-MM-DDTHH
  const match = cleaned.match(/^(.+?)_\d{4}-\d{2}-\d{2}/)
  return match ? match[1] : cleaned
}