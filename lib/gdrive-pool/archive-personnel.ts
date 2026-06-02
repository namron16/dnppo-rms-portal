// lib/gdrive-pool/archive-personnel.ts
//
// Moves all Google Drive files belonging to a separated personnel record
// into a dedicated archive folder structure:
//
//   DDNPPO RMS (root)
//     └── Personnel Files          ← find-or-create
//           └── Santos, Anna - Archived  ← find-or-create (one per person)
//                 └── [all doc files]
//
// Called by archiveExpiredPersonnel201Records() in data201.ts after the
// database status has been updated to 'Archived'.

import { getDriveClient, findOrCreateFolder } from './drive-client'
import { getServiceClient } from './db'
import type { SupabaseClient } from '@supabase/supabase-js'

const PERSONNEL_FOLDER_NAME = 'Personnel Files'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PersonnelArchiveInput {
  /** personnel_201.id */
  personnelId: string
  /** Full name, e.g. "Ana Santos" */
  name: string
  /** Rank, e.g. "P/Insp." */
  rank: string
  /** The root_folder_id stored in storage_pool for the uploader's Drive account */
  rootFolderId: string
  /** storage_pool.id of the Drive account that holds the files */
  poolAccountId: string
}

export interface PersonnelArchiveResult {
  success: boolean
  personnelId: string
  archiveFolderId?: string
  filesMoved: number
  filesSkipped: number
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats the personnel archive folder name.
 * "Ana Santos" + "P/Insp." → "Santos, Ana (P/Insp.) - Archived"
 */
function buildArchiveFolderName(name: string, rank: string): string {
  const parts = name.trim().split(' ')
  // Last word is treated as surname for "Surname, Firstname" format
  const surname   = parts[parts.length - 1] ?? name
  const firstname = parts.slice(0, -1).join(' ') || name
  const rankStr   = rank ? ` (${rank})` : ''
  return `${surname}, ${firstname}${rankStr} - Archived`
}

/**
 * Retrieves all Drive file IDs linked to a personnel record via the records table.
 * Each personnel_201_doc has its own record row with entity_type='doc_201'.
 */
async function getDriveFileIdsForPersonnel(
  db: SupabaseClient,
  personnelId: string
): Promise<Array<{ recordId: string; gdriveFileId: string; fileName: string }>> {
  // Step 1: get all doc IDs for this personnel
  const { data: docs, error: docsError } = await db
    .from('personnel_201_docs')
    .select('id, label')
    .eq('personnel_id', personnelId)

  if (docsError || !docs || docs.length === 0) {
    console.log(`[Archive] No docs found for personnel ${personnelId}`)
    return []
  }

  const docIds = docs.map((d: any) => d.id)

  // Step 2: find records rows for those doc IDs
  const { data: records, error: recordsError } = await db
    .from('records')
    .select('id, gdrive_file_id, file_name, entity_id')
    .eq('entity_type', 'doc_201')
    .in('entity_id', docIds)
    .eq('is_accessible', true)

  if (recordsError) {
    console.warn(`[Archive] records lookup error for personnel ${personnelId}:`, recordsError.message)
    return []
  }

  return (records ?? []).map((r: any) => ({
    recordId:    r.id,
    gdriveFileId: r.gdrive_file_id,
    fileName:    r.file_name,
  }))
}

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Moves all Drive files for one personnel record into:
 *   root → Personnel Files → {Name} - Archived
 *
 * Safe to call multiple times — find-or-create means it never creates
 * duplicate folders. Already-moved files will simply fail silently (404 from Drive).
 */
export async function archivePersonnelFilesToDrive(
  input: PersonnelArchiveInput
): Promise<PersonnelArchiveResult> {
  const { personnelId, name, rank, rootFolderId, poolAccountId } = input

  console.log(`[Archive] Starting Drive archive for personnel: ${name} (${personnelId})`)

  const db = getServiceClient()

  // ── 1. Get all Drive files for this personnel ──────────────────────────────
  const driveFiles = await getDriveFileIdsForPersonnel(db, personnelId)

  if (driveFiles.length === 0) {
    console.log(`[Archive] No Drive files to move for ${name} — archive folder not created.`)
    return { success: true, personnelId, filesMoved: 0, filesSkipped: 0 }
  }

  console.log(`[Archive] Found ${driveFiles.length} Drive file(s) for ${name}`)

  // ── 2. Get the Drive client ────────────────────────────────────────────────
  let drive: Awaited<ReturnType<typeof getDriveClient>>
  try {
    drive = await getDriveClient(poolAccountId)
  } catch (err: any) {
    const msg = `Failed to get Drive client for pool ${poolAccountId}: ${err.message}`
    console.error(`[Archive]`, msg)
    return { success: false, personnelId, filesMoved: 0, filesSkipped: 0, error: msg }
  }

  // ── 3. Find-or-create "Personnel Files" folder under root ──────────────────
  let personnelFolderId: string
  try {
    const result = await findOrCreateFolder(drive, PERSONNEL_FOLDER_NAME, rootFolderId)
    personnelFolderId = result.folderId
    console.log(
      `[Archive] Personnel Files folder: ${personnelFolderId} (isNew=${result.isNew})`
    )
  } catch (err: any) {
    const msg = `Failed to find/create "Personnel Files" folder: ${err.message}`
    console.error(`[Archive]`, msg)
    return { success: false, personnelId, filesMoved: 0, filesSkipped: 0, error: msg }
  }

  // ── 4. Find-or-create the individual personnel archive folder ──────────────
  const archiveFolderName = buildArchiveFolderName(name, rank)
  let archiveFolderId: string
  try {
    const result = await findOrCreateFolder(drive, archiveFolderName, personnelFolderId)
    archiveFolderId = result.folderId
    console.log(
      `[Archive] Archive folder "${archiveFolderName}": ${archiveFolderId} (isNew=${result.isNew})`
    )
  } catch (err: any) {
    const msg = `Failed to find/create archive folder "${archiveFolderName}": ${err.message}`
    console.error(`[Archive]`, msg)
    return { success: false, personnelId, filesMoved: 0, filesSkipped: 0, error: msg }
  }

  // ── 5. Move each file into the archive folder ──────────────────────────────
  let filesMoved   = 0
  let filesSkipped = 0

  for (const fileRef of driveFiles) {
    try {
      // Get current parent(s) of the file so we can remove them
      const metaRes = await drive.files.get({
        fileId: fileRef.gdriveFileId,
        fields: 'id, parents, trashed',
      })

      const fileMeta = metaRes.data as { id: string; parents?: string[]; trashed?: boolean }

      if (fileMeta.trashed) {
        console.warn(`[Archive] File ${fileRef.gdriveFileId} is already trashed — skipping.`)
        filesSkipped++
        continue
      }

      const currentParents = (fileMeta.parents ?? []).join(',')

      if (currentParents === archiveFolderId) {
        // Already in the right folder
        filesMoved++
        continue
      }

      await drive.files.update({
        fileId:        fileRef.gdriveFileId,
        addParents:    archiveFolderId,
        removeParents: currentParents || undefined,
        requestBody:   {},
        fields:        'id, parents',
      })

      console.log(
        `[Archive] Moved file "${fileRef.fileName}" (${fileRef.gdriveFileId}) → "${archiveFolderName}"`
      )

      filesMoved++
    } catch (err: any) {
      const status = err?.response?.status ?? err?.code
      if (status === 404) {
        // File was already deleted from Drive — mark inaccessible in DB
        console.warn(`[Archive] File ${fileRef.gdriveFileId} not found in Drive (404) — marking inaccessible.`)
        await db
          .from('records')
          .update({ is_accessible: false, last_synced: new Date().toISOString() })
          .eq('id', fileRef.recordId)
        filesSkipped++
      } else {
        console.error(
          `[Archive] Failed to move file "${fileRef.fileName}" (${fileRef.gdriveFileId}):`,
          err.message
        )
        filesSkipped++
      }
    }
  }

  console.log(
    `[Archive] Done for ${name}: moved=${filesMoved}, skipped=${filesSkipped}, folder="${archiveFolderName}"`
  )

  return {
    success:        true,
    personnelId,
    archiveFolderId,
    filesMoved,
    filesSkipped,
  }
}

/**
 * Archives multiple personnel records in sequence.
 * Returns a summary of results — partial failures do not stop the batch.
 */
export async function archiveBatchPersonnelFiles(
  records: PersonnelArchiveInput[]
): Promise<{
  totalProcessed: number
  totalFilesMoved: number
  failures: Array<{ personnelId: string; name: string; error: string }>
}> {
  let totalFilesMoved = 0
  const failures: Array<{ personnelId: string; name: string; error: string }> = []

  for (const record of records) {
    const result = await archivePersonnelFilesToDrive(record)
    if (result.success) {
      totalFilesMoved += result.filesMoved
    } else {
      failures.push({
        personnelId: record.personnelId,
        name:        record.name,
        error:       result.error ?? 'Unknown error',
      })
    }
  }

  return {
    totalProcessed: records.length,
    totalFilesMoved,
    failures,
  }
}