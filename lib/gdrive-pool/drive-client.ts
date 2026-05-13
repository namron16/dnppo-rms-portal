// lib/gdrive-pool/drive-client.ts
// Google Drive API v3 wrapper with automatic token refresh.
// Uses googleapis npm package — install with: npm install googleapis

import { google, drive_v3 } from 'googleapis'
import type { GaxiosResponse } from 'gaxios'
import { Readable } from 'stream'
import {
  getCachedAccessToken,
  getDecryptedRefreshToken,
  saveAccessToken,
  markPoolAccountError,
  logHealthEvent,
} from './db'
import type { DriveFolderResult, DriveFileMetadata } from './types'

// =============================================================================
// OAUTH2 CLIENT FACTORY
// =============================================================================

function buildOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET env vars.')
  }

  return new google.auth.OAuth2(clientId, clientSecret)
}

/**
 * Returns an authorized OAuth2 client for a given pool account.
 * Automatically refreshes the access token if expired.
 * Throws and marks the account as ERROR on invalid_grant.
 */
export async function getAuthorizedClient(poolId: string) {
  const oauth2 = buildOAuth2Client()

  // Try cached access token first
  const cached = await getCachedAccessToken(poolId)
  if (cached) {
    oauth2.setCredentials({ access_token: cached })
    return oauth2
  }

  // Need to refresh
  const refreshToken = await getDecryptedRefreshToken(poolId)
  if (!refreshToken) {
    await markPoolAccountError(poolId, 'No refresh token stored — reconnect required.')
    throw new Error(`Pool account ${poolId}: missing refresh token.`)
  }

  oauth2.setCredentials({ refresh_token: refreshToken })

  try {
    const { credentials } = await oauth2.refreshAccessToken()

    if (!credentials.access_token) {
      throw new Error('Google returned no access_token during refresh.')
    }

    // Persist the new access token
    await saveAccessToken(
      poolId,
      credentials.access_token,
      credentials.expiry_date
        ? Math.floor((credentials.expiry_date - Date.now()) / 1000)
        : 3600
    )

    await logHealthEvent({
      pool_account_id: poolId,
      event_type: 'token_refresh',
      status: 'ok',
      message: 'Access token refreshed successfully.',
      latency_ms: null,
    })

    oauth2.setCredentials(credentials)
    return oauth2
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    const isInvalidGrant = msg.includes('invalid_grant') || msg.includes('Token has been expired')

    await markPoolAccountError(
      poolId,
      isInvalidGrant
        ? 'invalid_grant — user must reconnect their Google account.'
        : `Token refresh failed: ${msg}`
    )

    await logHealthEvent({
      pool_account_id: poolId,
      event_type: 'token_refresh',
      status: 'error',
      message: msg,
      latency_ms: null,
    })

    throw new Error(
      isInvalidGrant
        ? `Pool account ${poolId}: Google refresh token has been revoked. Reconnect required.`
        : `Pool account ${poolId}: token refresh failed — ${msg}`
    )
  }
}

/**
 * Returns a Drive v3 client pre-authorized for the given pool account.
 */
export async function getDriveClient(poolId: string): Promise<drive_v3.Drive> {
  const auth = await getAuthorizedClient(poolId)
  return google.drive({ version: 'v3', auth })
}

// =============================================================================
// FOLDER OPERATIONS
// =============================================================================

/**
 * Finds an existing folder by name under a parent, or creates it.
 * Returns the Drive folder ID and whether it was newly created.
 */
export async function findOrCreateFolder(
  drive: drive_v3.Drive,
  folderName: string,
  parentId: string
): Promise<DriveFolderResult> {
  // Search for existing folder
  const searchRes = await drive.files.list({
    q: [
      `name = '${folderName.replace(/'/g, "\\'")}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `'${parentId}' in parents`,
      `trashed = false`,
    ].join(' and '),
    fields: 'files(id, name)',
    spaces: 'drive',
    pageSize: 1,
  })

  const existing = searchRes.data.files?.[0]
  if (existing?.id) {
    return { folderId: existing.id, folderName, isNew: false }
  }

  // Create new folder
  const createRes = await drive.files.create({
    requestBody: {
      name:     folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents:  [parentId],
    },
    fields: 'id',
  })

  if (!createRes.data.id) {
    throw new Error(`Failed to create folder "${folderName}" under parent ${parentId}`)
  }

  return { folderId: createRes.data.id, folderName, isNew: true }
}

/**
 * Creates the root "DDNPPO RMS" folder in a user's Drive.
 * Called once during account connect.
 */
export async function createRootFolder(drive: drive_v3.Drive): Promise<string> {
  const res = await drive.files.create({
    requestBody: {
      name:     'DDNPPO RMS',
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  })

  if (!res.data.id) throw new Error('Failed to create DDNPPO RMS root folder.')
  return res.data.id
}

// =============================================================================
// FILE OPERATIONS
// =============================================================================

/**
 * Uploads a file buffer to Google Drive under the specified parent folder.
 * Returns full Drive file metadata.
 */
export async function uploadFileToDrive(params: {
  drive: drive_v3.Drive
  fileBuffer: Buffer | Uint8Array
  fileName: string
  mimeType: string
  parentFolderId: string
}): Promise<DriveFileMetadata> {
  const { drive, fileBuffer, fileName, mimeType, parentFolderId } = params

  // Convert buffer to readable stream
  const stream = Readable.from(fileBuffer)

  const res = await drive.files.create({
    requestBody: {
      name:    fileName,
      parents: [parentFolderId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: [
      'id', 'name', 'mimeType', 'size',
      'webViewLink', 'webContentLink', 'thumbnailLink',
      'parents', 'createdTime', 'modifiedTime',
    ].join(','),
  }) as unknown as GaxiosResponse<DriveFileMetadata>

  if (!res.data.id) throw new Error(`Drive upload failed for file "${fileName}"`)

  // Make the file readable by anyone with the link
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role: 'reader', type: 'anyone' },
  })

  return res.data as DriveFileMetadata
}

/**
 * Deletes a file from Google Drive.
 * Does not throw if the file is already gone (404).
 */
export async function deleteFileFromDrive(
  drive: drive_v3.Drive,
  fileId: string
): Promise<void> {
  try {
    await drive.files.delete({ fileId })
  } catch (err: any) {
    const status = err?.response?.status ?? err?.code
    if (status !== 404) throw err   // re-throw non-404 errors
    // 404 = already deleted — treat as success
  }
}

/**
 * Fetches live Drive file metadata.
 * Returns null if the file does not exist or is trashed.
 */
export async function getFileMetadata(
  drive: drive_v3.Drive,
  fileId: string
): Promise<DriveFileMetadata | null> {
  try {
    const res = await drive.files.get({
      fileId,
      fields: [
        'id', 'name', 'mimeType', 'size',
        'webViewLink', 'webContentLink', 'thumbnailLink',
        'parents', 'trashed', 'createdTime', 'modifiedTime',
      ].join(','),
    }) as unknown as GaxiosResponse<DriveFileMetadata & { trashed?: boolean }>

    if (res.data.trashed) return null
    return res.data as DriveFileMetadata
  } catch (err: any) {
    if (err?.response?.status === 404) return null
    throw err
  }
}

/**
 * Returns Drive storage quota for a pool account.
 */
export async function getDriveQuota(drive: drive_v3.Drive): Promise<{
  limit: number | null      // null = unlimited (G Suite)
  usage: number
  usageInDrive: number
}> {
  const res = await drive.about.get({
    fields: 'storageQuota(limit,usage,usageInDrive)',
  })

  const q = res.data.storageQuota
  return {
    limit:         q?.limit        ? parseInt(q.limit,        10) : null,
    usage:         q?.usage        ? parseInt(q.usage,        10) : 0,
    usageInDrive:  q?.usageInDrive ? parseInt(q.usageInDrive, 10) : 0,
  }
}

/**
 * Performs a lightweight connectivity + auth check against the Drive API.
 * Returns latency in ms and whether the call succeeded.
 */
export async function pingDriveAccount(poolId: string): Promise<{
  ok: boolean
  latencyMs: number
  error?: string
  email?: string
  quotaBytes?: number
  usedBytes?: number
}> {
  const start = Date.now()

  try {
    const drive = await getDriveClient(poolId)
    const res   = await drive.about.get({ fields: 'user(emailAddress),storageQuota(limit,usage)' })

    const latencyMs  = Date.now() - start
    const quota      = res.data.storageQuota
    const quotaBytes = quota?.limit  ? parseInt(quota.limit,  10) : 15 * 1024 ** 3
    const usedBytes  = quota?.usage  ? parseInt(quota.usage,  10) : 0

    return {
      ok:          true,
      latencyMs,
      email:       res.data.user?.emailAddress ?? undefined,
      quotaBytes,
      usedBytes,
    }
  } catch (err: any) {
    return {
      ok:        false,
      latencyMs: Date.now() - start,
      error:     err?.message ?? String(err),
    }
  }
}

// =============================================================================
// GOOGLE OAUTH2 FLOW HELPERS
// =============================================================================

/**
 * Generates the Google OAuth2 authorization URL for a user.
 * Redirect the user's browser to this URL.
 */
export function getAuthorizationUrl(username: string, redirectUri: string): string {
  const oauth2 = buildOAuth2Client()

  return oauth2.generateAuthUrl({
    access_type:            'offline',
    prompt:                 'consent',
    include_granted_scopes: false,       // ← ADD THIS
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email',
      'openid',                          // ← ADD THIS (Google requires it when using userinfo)
    ],
    redirect_uri: redirectUri,
    state: JSON.stringify({ username }),
  })
}

/**
 * Exchanges an authorization code for OAuth2 tokens.
 * Called in the OAuth2 callback route.
 */
export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const oauth2    = buildOAuth2Client()
  const { tokens } = await oauth2.getToken({ code, redirect_uri: redirectUri })

  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh_token. ' +
      'Ensure prompt=consent is set and the user has not already granted access.'
    )
  }

  return tokens
}

/**
 * Gets the authenticated user's Gmail address using an access token.
 */
export async function getAuthenticatedEmail(accessToken: string): Promise<string> {
  const oauth2 = buildOAuth2Client()
  oauth2.setCredentials({ access_token: accessToken })

  const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 })
  const { data }  = await oauth2Api.userinfo.get()

  if (!data.email) throw new Error('Could not retrieve user email from Google.')
  return data.email
}