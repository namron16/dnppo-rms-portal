// lib/gdrive-pool/gateway.ts
// Centralized Upload Gateway
//
// KEY FIX (migration 003):
//   selectPoolAccount() is now scoped to the uploading user's own Drive accounts.
//   It NEVER routes an upload to another user's Drive account.
//   The username (= role string e.g. 'P1', 'DPDA') is resolved from req.uploadedBy
//   and passed through every fallback path.
//
// FIX (restore):
//   Added moveFileFromArchiveFolder() — the exact inverse of moveFileToArchiveFolder().
//   Called by /api/gdrive/restore when a document is restored from the Archive page.

import { getDriveClient, findOrCreateFolder, uploadFileToDrive, deleteFileFromDrive } from './drive-client'
import {
  rpcPickUploadTarget,
  rpcIncrementStorage,
  rpcDecrementStorage,
  getCachedFolderId,
  cacheFolderId,
  insertRecord,
  deleteRecord,
  getPoolAccountsByUsername,
  getPoolAccountFull,
  markPoolAccountError,
  logHealthEvent,
} from './db'
import { CATEGORY_DISPLAY_NAMES } from './types'
import type {
  UploadRequest,
  UploadResult,
  DeleteRequest,
  DeleteResult,
  DocumentCategory,
  DbRecord,
} from './types'

// =============================================================================
// MIME ALLOWLIST
// =============================================================================

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

function isMimeAllowed(mimeType: string): boolean {
  return mimeType.startsWith('image/') || ALLOWED_MIMES.has(mimeType)
}

// =============================================================================
// POOL SELECTION — scoped to the uploading user's own accounts only
// =============================================================================

interface ScopedPoolSelectionOptions {
  username:       string
  fileSizeBytes:  number
  pinnedPoolId?:  string
  excludePoolIds?: string[]
}

async function selectPoolAccount(opts: ScopedPoolSelectionOptions): Promise<string | null> {
  const { username, fileSizeBytes, pinnedPoolId, excludePoolIds = [] } = opts

  if (pinnedPoolId) {
    try {
      const row = await getPoolAccountFull(pinnedPoolId)
      if (row.owner_username !== username) {
        console.error(
          `[Gateway] SECURITY: pinned pool ${pinnedPoolId} belongs to ` +
          `${row.owner_username}, not ${username}. Ignoring pin.`
        )
      } else if (row.is_active) {
        console.log(`[Gateway] Using pinned pool account: ${pinnedPoolId} (${row.account_email})`)
        return pinnedPoolId
      }
    } catch (e: any) {
      console.warn(`[Gateway] Pinned account ${pinnedPoolId} lookup failed:`, e.message)
    }
  }

  try {
    const target = await rpcPickUploadTarget(username, fileSizeBytes)
    if (target) {
      console.log(
        `[Gateway] RPC picked pool account for ${username}: ` +
        `${target.pool_account_id} (${target.account_email})`
      )
      return target.pool_account_id
    }
    console.warn(
      `[Gateway] rpcPickUploadTarget returned null for username=${username}, ` +
      `fileSize=${fileSizeBytes}. All accounts may be full or inactive.`
    )
  } catch (e: any) {
    console.warn('[Gateway] rpcPickUploadTarget threw:', e.message)
  }

  const userAccounts = await getPoolAccountsByUsername(username)

  console.log(
    `[Gateway] Fallback: scanning ${userAccounts.length} accounts for user ${username}`
  )

  if (userAccounts.length === 0) {
    console.error(
      `[Gateway] User ${username} has no connected Google Drive accounts. ` +
      `An admin must connect a Drive account for this user at /admin/gdrive.`
    )
    return null
  }

  const active = userAccounts.find(
    a => a.is_active && a.status === 'ACTIVE' && !excludePoolIds.includes(a.id)
  )
  if (active) {
    console.log(
      `[Gateway] Fallback picked ACTIVE account for ${username}: ` +
      `${active.id} (${active.account_email})`
    )
    return active.id
  }

  const anyActive = userAccounts.find(
    a => a.is_active && !excludePoolIds.includes(a.id)
  )
  if (anyActive) {
    console.warn(
      `[Gateway] Last-resort for ${username}: using account with ` +
      `status=${anyActive.status}: ${anyActive.id} (${anyActive.account_email})`
    )
    return anyActive.id
  }

  console.error(
    `[Gateway] No usable Drive accounts for user ${username}. ` +
    `Accounts: ${userAccounts.map(a =>
      `${a.account_email}(active=${a.is_active},status=${a.status})`
    ).join(', ')}`
  )
  return null
}

// =============================================================================
// CATEGORY FOLDER RESOLUTION
// =============================================================================

async function resolveCategoryFolder(
  poolAccountId: string,
  category: DocumentCategory,
  rootFolderId: string
): Promise<string> {
  const folderName = CATEGORY_DISPLAY_NAMES[category]

  const cached = await getCachedFolderId(poolAccountId, folderName)
  if (cached) {
    console.log(`[Gateway] Category folder cache hit: "${folderName}" → ${cached}`)
    return cached
  }

  console.log(`[Gateway] Category folder cache miss for "${folderName}" — creating in Drive`)

  const drive = await getDriveClient(poolAccountId)

  let folderId: string
  try {
    const result = await findOrCreateFolder(drive, folderName, rootFolderId)
    folderId = result.folderId
    console.log(`[Gateway] Folder "${folderName}" resolved: ${folderId} (isNew=${result.isNew})`)
  } catch (err: any) {
    console.error(`[Gateway] findOrCreateFolder failed for "${folderName}":`, err.message)
    throw err
  }

  await cacheFolderId(poolAccountId, folderName, folderId)
  return folderId
}

// =============================================================================
// MAIN UPLOAD FUNCTION
// =============================================================================

export async function uploadFile(req: UploadRequest): Promise<UploadResult> {
  console.log(
    `[Gateway] uploadFile() start: file="${req.fileName}", mime="${req.mimeType}", ` +
    `size=${req.fileSizeBytes}, category="${req.category}", uploadedBy="${req.uploadedBy}"`
  )

  if (!isMimeAllowed(req.mimeType)) {
    const msg = `Unsupported MIME type: ${req.mimeType}. Allowed: PDF, images, DOCX, XLSX.`
    console.error('[Gateway]', msg)
    return { success: false, error: msg }
  }

  const poolAccountId = await selectPoolAccount({
    username:      req.uploadedBy,
    fileSizeBytes: req.fileSizeBytes,
    pinnedPoolId:  req.preferredPoolId,
  })

  if (!poolAccountId) {
    const msg =
      `No active Google Drive account found for user "${req.uploadedBy}". ` +
      `An admin must connect a Drive account for this user at /admin/gdrive.`
    console.error('[Gateway]', msg)
    return { success: false, error: msg }
  }

  let poolRow: Awaited<ReturnType<typeof getPoolAccountFull>>
  try {
    poolRow = await getPoolAccountFull(poolAccountId)
    console.log(
      `[Gateway] Pool account: ${poolRow.account_email} ` +
      `(owner: ${poolRow.owner_username}), root_folder_id=${poolRow.root_folder_id}`
    )
  } catch (err: any) {
    console.error('[Gateway] Failed to load pool account:', err.message)
    return { success: false, error: `Failed to load pool account: ${err.message}` }
  }

  if (poolRow.owner_username !== req.uploadedBy) {
    const msg =
      `[Gateway] SECURITY VIOLATION: pool account ${poolAccountId} ` +
      `belongs to ${poolRow.owner_username} but upload is from ${req.uploadedBy}. Blocked.`
    console.error(msg)
    return { success: false, error: 'Storage account ownership mismatch. Upload blocked.' }
  }

  if (!poolRow.root_folder_id) {
    const msg =
      `Pool account ${poolAccountId} (${poolRow.account_email}) has no root folder configured. ` +
      `Re-run the OAuth connect flow for user ${req.uploadedBy}.`
    console.error('[Gateway]', msg)
    return { success: false, error: msg }
  }

  let categoryFolderId: string
  try {
    categoryFolderId = await resolveCategoryFolder(
      poolAccountId,
      req.category,
      poolRow.root_folder_id
    )
    console.log(`[Gateway] Category folder ID: ${categoryFolderId}`)
  } catch (err: any) {
    const msg = `Folder resolution failed: ${err.message}`
    console.error('[Gateway]', msg)
    await markPoolAccountError(poolAccountId, msg)
    return { success: false, error: msg }
  }

  let driveFile: Awaited<ReturnType<typeof uploadFileToDrive>>
  let drive: Awaited<ReturnType<typeof getDriveClient>>

  try {
    console.log(`[Gateway] Uploading to Drive: parentFolder=${categoryFolderId}`)
    drive     = await getDriveClient(poolAccountId)
    driveFile = await uploadFileToDrive({
      drive,
      fileBuffer:     Buffer.isBuffer(req.file) ? req.file : Buffer.from(req.file),
      fileName:       req.fileName,
      mimeType:       req.mimeType,
      parentFolderId: categoryFolderId,
    })
    console.log(
      `[Gateway] Drive upload success: fileId=${driveFile.id}, ` +
      `webViewLink=${driveFile.webViewLink}`
    )
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    console.error('[Gateway] Drive upload failed:', msg)
    console.error('[Gateway] Drive error stack:', err?.stack)

    const isAuth =
      msg.toLowerCase().includes('invalid_grant') ||
      msg.toLowerCase().includes('unauthorized') ||
      msg.toLowerCase().includes('reconnect') ||
      msg.toLowerCase().includes('invalid credentials')

    if (isAuth) {
      await markPoolAccountError(poolAccountId, `Drive auth error: ${msg}`)
      console.error(`[Gateway] Auth error — marked account ${poolAccountId} as ERROR`)
    }

    return { success: false, poolAccountId, error: `Drive upload failed: ${msg}` }
  }

  let record: DbRecord
  try {
    record = await insertRecord({
      file_name:          driveFile.name,
      original_name:      req.fileName,
      gdrive_file_id:     driveFile.id,
      mime_type:          req.mimeType,
      pool_account_id:    poolAccountId,
      category_folder_id: categoryFolderId,
      category:           req.category,
      size_bytes:         parseInt(driveFile.size ?? '0', 10) || req.fileSizeBytes,
      drive_url:          driveFile.webViewLink    ?? null,
      thumbnail_url:      driveFile.thumbnailLink  ?? null,
      download_url:       driveFile.webContentLink ?? null,
      entity_type:        req.entityType  ?? null,
      entity_id:          req.entityId    ?? null,
      uploaded_by:        req.uploadedBy,
      is_accessible:      true,
    })
    console.log(`[Gateway] Record inserted: id=${record.id}`)
  } catch (err: any) {
    console.error('[Gateway] Record insert failed — rolling back Drive file:', err.message)
    try { await deleteFileFromDrive(drive!, driveFile.id) } catch (e: any) {
      console.error('[Gateway] Rollback (Drive delete) also failed:', e.message)
    }
    return {
      success:       false,
      poolAccountId,
      error:         `Database record insert failed: ${err.message}`,
    }
  }

  try {
    await rpcIncrementStorage(poolAccountId, record.size_bytes)
  } catch (err: any) {
    console.warn('[Gateway] Storage increment failed (non-fatal):', err.message)
  }

  await logHealthEvent({
    pool_account_id: poolAccountId,
    event_type:      'health_check',
    status:          'ok',
    message:
      `Uploaded "${req.fileName}" (${(record.size_bytes / 1024).toFixed(1)} KB) ` +
      `to ${req.category} for user ${req.uploadedBy}`,
    latency_ms: null,
  })

  console.log(
    `[Gateway] uploadFile() complete: gdriveFileId=${driveFile.id}, ` +
    `owner=${req.uploadedBy}, driveUrl=${driveFile.webViewLink}`
  )

  return {
    success:      true,
    record,
    poolAccountId,
    accountEmail:  poolRow.account_email,
    gdriveFileId:  driveFile.id,
    driveUrl:      driveFile.webViewLink    ?? undefined,
    downloadUrl:   driveFile.webContentLink ?? undefined,
  }
}

// =============================================================================
// DELETE
// =============================================================================

export async function deleteFile(req: DeleteRequest): Promise<DeleteResult> {
  let sizeBytes = 0

  try {
    const drive = await getDriveClient(req.poolAccountId)

    const { data: rec } = await (async () => {
      const db = (await import('./db')).getServiceClient()
      return db
        .from('records')
        .select('size_bytes')
        .eq('id', req.recordId)
        .maybeSingle()
    })()

    sizeBytes = (rec as any)?.size_bytes ?? 0

    await deleteFileFromDrive(drive, req.gdriveFileId)
    await deleteRecord(req.recordId)

    if (sizeBytes > 0) {
      await rpcDecrementStorage(req.poolAccountId, sizeBytes)
    }

    return { success: true }
  } catch (err: any) {
    console.error('[Gateway] deleteFile failed:', err.message)
    return { success: false, error: err?.message ?? String(err) }
  }
}

// =============================================================================
// ARCHIVE — move file into the category's archive subfolder
// =============================================================================

/**
 * Moves a file INTO the archive subfolder for its category.
 * e.g.  "Master Documents" → "Master Documents – Archive"  (created if missing)
 *
 * findOrCreateFolder() searches before creating, so reconnecting a Drive
 * account will reuse the existing archive folder rather than creating a new one.
 */
export async function moveFileToArchiveFolder(
  poolAccountId: string,
  gdriveFileId: string,
  category: DocumentCategory,
  rootFolderId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const drive = await getDriveClient(poolAccountId)

    const categoryFolderName = CATEGORY_DISPLAY_NAMES[category]
    const archiveFolderName  = `${categoryFolderName} – Archive`

    // Resolve the main category folder (find-or-create, cached)
    const categoryFolderId = await resolveCategoryFolder(
      poolAccountId,
      category,
      rootFolderId
    )

    // Find-or-create the archive subfolder inside the category folder.
    // findOrCreateFolder() always searches first, so this is idempotent —
    // reconnecting a Drive account never creates a duplicate archive folder.
    const archiveFolder = await findOrCreateFolder(
      drive,
      archiveFolderName,
      categoryFolderId
    )

    // Move the file: add archive folder as parent, remove category folder
    await drive.files.update({
      fileId:        gdriveFileId,
      addParents:    archiveFolder.folderId,
      removeParents: categoryFolderId,
      requestBody:   {},
      fields:        'id, parents',
    })

    console.log(
      `[Gateway] moveFileToArchiveFolder: moved file ${gdriveFileId} ` +
      `to "${archiveFolderName}" (folderId=${archiveFolder.folderId}, ` +
      `isNew=${archiveFolder.isNew})`
    )

    return { success: true }
  } catch (err: any) {
    console.error('[Gateway] moveFileToArchiveFolder failed:', err.message)
    return { success: false, error: err.message }
  }
}

// =============================================================================
// RESTORE — move file back from archive subfolder to main category folder
// =============================================================================

/**
 * Moves a file FROM the archive subfolder BACK to the main category folder.
 * This is the exact inverse of moveFileToArchiveFolder().
 *
 * e.g.  "Master Documents – Archive" → "Master Documents"
 *
 * If the archive folder doesn't exist (file was never moved, or folder was
 * manually deleted), this is a safe no-op — the file is already in the right
 * place and success is returned.
 *
 * findOrCreateFolder() is NOT used here for the archive subfolder — we only
 * search for it.  We never want to create an archive folder during a restore.
 */
export async function moveFileFromArchiveFolder(
  poolAccountId: string,
  gdriveFileId: string,
  category: DocumentCategory,
  rootFolderId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const drive = await getDriveClient(poolAccountId)

    const categoryFolderName = CATEGORY_DISPLAY_NAMES[category]
    const archiveFolderName  = `${categoryFolderName} – Archive`

    // ── 1. Resolve the main category folder (find-or-create, cached) ─────────
    const categoryFolderId = await resolveCategoryFolder(
      poolAccountId,
      category,
      rootFolderId
    )

    // ── 2. Search for the archive subfolder — do NOT create if missing ────────
    const searchRes = await drive.files.list({
      q: [
        `name = '${archiveFolderName.replace(/'/g, "\\'")}'`,
        `mimeType = 'application/vnd.google-apps.folder'`,
        `'${categoryFolderId}' in parents`,
        `trashed = false`,
      ].join(' and '),
      fields:    'files(id, name)',
      spaces:    'drive',
      pageSize:  1,
    })

    const archiveFolder = searchRes.data.files?.[0]

    if (!archiveFolder?.id) {
      // Archive folder doesn't exist — the file is already in the main folder
      // (or was never moved).  Treat as success.
      console.log(
        `[Gateway] moveFileFromArchiveFolder: archive folder "${archiveFolderName}" ` +
        `not found — file ${gdriveFileId} is already in the main folder. No-op.`
      )
      return { success: true }
    }

    const archiveFolderId = archiveFolder.id

    // ── 3. Move the file: add main folder as parent, remove archive folder ────
    await drive.files.update({
      fileId:        gdriveFileId,
      addParents:    categoryFolderId,
      removeParents: archiveFolderId,
      requestBody:   {},
      fields:        'id, parents',
    })

    console.log(
      `[Gateway] moveFileFromArchiveFolder: moved file ${gdriveFileId} ` +
      `from "${archiveFolderName}" back to "${categoryFolderName}"`
    )

    return { success: true }
  } catch (err: any) {
    console.error('[Gateway] moveFileFromArchiveFolder failed:', err.message)
    return { success: false, error: err.message }
  }
}

// =============================================================================
// URL HELPERS
// =============================================================================

export function buildDirectDownloadUrl(gdriveFileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${gdriveFileId}`
}

export function buildPreviewUrl(gdriveFileId: string): string {
  return `https://drive.google.com/file/d/${gdriveFileId}/preview`
}