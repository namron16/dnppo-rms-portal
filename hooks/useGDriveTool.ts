// hooks/useGDrivePool.ts
// React hook for interacting with the Google Drive Pooling System from client components.
// Wraps all API calls and manages loading/error state.

'use client'

import { useState, useCallback } from 'react'
import type { DocumentCategory } from '@/lib/gdrive-pool/types'

// =============================================================================
// TYPES
// =============================================================================

export interface UploadFileOptions {
  file: File
  category: DocumentCategory
  entityType?: string
  entityId?: string
  uploadedBy: string
  preferredPoolId?: string
  onProgress?: (pct: number) => void
}

export interface UploadFileResult {
  success: boolean
  driveUrl?: string
  downloadUrl?: string
  gdriveFileId?: string
  poolAccountId?: string
  accountEmail?: string
  recordId?: string
  error?: string
}

export interface DeleteFileOptions {
  gdriveFileId: string
  poolAccountId: string
  recordId: string
}

export interface PoolStatusData {
  quickStatus: {
    totalAccounts: number
    healthyAccounts: number
    totalUsedGb: number
    totalQuotaGb: number
    usagePct: number
    hasErrors: boolean
  }
  summary: {
    total_accounts: number
    active_accounts: number
    error_accounts: number
    total_quota_gb: number
    total_used_gb: number
    total_files: number
    overall_usage_pct: number
  }
  accounts: Array<{
    id: string
    accountEmail: string
    status: 'ACTIVE' | 'ERROR' | 'MAINTENANCE'
    isActive: boolean
    usageGb: number
    quotaGb: number
    usagePct: number
    fileCount: number
    errorMessage: string | null
    lastHealthCheck: string | null
    connectedAt: string
  }>
}

// =============================================================================
// HOOK
// =============================================================================

export function useGDrivePool() {
  const [uploading,  setUploading]  = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // ── Upload ─────────────────────────────────────────────────────────────────
  const uploadFile = useCallback(async (opts: UploadFileOptions): Promise<UploadFileResult> => {
    setUploading(true)
    setUploadProgress(0)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file',        opts.file)
      formData.append('category',    opts.category)
      formData.append('uploadedBy',  opts.uploadedBy)

      if (opts.entityType)      formData.append('entityType',      opts.entityType)
      if (opts.entityId)        formData.append('entityId',        opts.entityId)
      if (opts.preferredPoolId) formData.append('preferredPoolId', opts.preferredPoolId)

      // Use XMLHttpRequest for progress events
      const result = await new Promise<UploadFileResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100)
            setUploadProgress(pct)
            opts.onProgress?.(pct)
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status === 201) {
            try {
              const json = JSON.parse(xhr.responseText)
              const r    = json.data
              resolve({
                success:       true,
                // The API route returns the PoolUploadResult shape from uploadViaPool:
                // { fileUrl, downloadUrl, previewUrl, gdriveFileId, poolAccountId, accountEmail, recordId, sizeBytes }
                driveUrl:      r.fileUrl      ?? r.driveUrl,
                downloadUrl:   r.downloadUrl,
                gdriveFileId:  r.gdriveFileId,
                poolAccountId: r.poolAccountId,
                accountEmail:  r.accountEmail,
                recordId:      r.recordId     ?? r.record?.id,
              })
            } catch {
              resolve({ success: false, error: 'Failed to parse upload response.' })
            }
          } else {
            try {
              const json = JSON.parse(xhr.responseText)
              resolve({ success: false, error: json.error ?? `HTTP ${xhr.status}` })
            } catch {
              resolve({ success: false, error: `HTTP ${xhr.status}` })
            }
          }
        })

        xhr.addEventListener('error', () => {
          reject(new Error('Upload failed: no network connection. Check your internet and try again.'))
        })

        xhr.addEventListener('abort', () => {
          reject(new Error('Upload aborted.'))
        })

        xhr.open('POST', '/api/gdrive/upload')
        xhr.send(formData)
      })

      if (!result.success) setError(result.error ?? 'Upload failed.')
      return result
    } catch (err: any) {
      const msg = err?.message ?? 'Upload failed.'
      setError(msg)
      return { success: false, error: msg }
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }, [])

  // ── Delete ─────────────────────────────────────────────────────────────────
  const deleteFile = useCallback(async (opts: DeleteFileOptions): Promise<{ success: boolean; error?: string }> => {
    setDeleting(true)
    setError(null)

    try {
      const res  = await fetch('/api/gdrive/delete', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(opts),
      })
      const json = await res.json()

      if (!res.ok || !json.data?.success) {
        const msg = json.error ?? 'Delete failed.'
        setError(msg)
        return { success: false, error: msg }
      }

      return { success: true }
    } catch (err: any) {
      const msg = err?.message ?? 'Delete request failed.'
      setError(msg)
      return { success: false, error: msg }
    } finally {
      setDeleting(false)
    }
  }, [])

  // ── Get pool status ────────────────────────────────────────────────────────
  const getPoolStatus = useCallback(async (): Promise<PoolStatusData | null> => {
    setStatusLoading(true)
    try {
      const res  = await fetch('/api/gdrive/status')
      const json = await res.json()
      return json.data ?? null
    } catch {
      return null
    } finally {
      setStatusLoading(false)
    }
  }, [])

  // ── Utility: build Drive preview URL ──────────────────────────────────────
  const getPreviewUrl = useCallback((gdriveFileId: string) => {
    return `https://drive.google.com/file/d/${gdriveFileId}/preview`
  }, [])

  const getDownloadUrl = useCallback((gdriveFileId: string) => {
    return `https://drive.google.com/uc?export=download&id=${gdriveFileId}`
  }, [])

  return {
    // State
    uploading,
    deleting,
    statusLoading,
    uploadProgress,
    error,

    // Actions
    uploadFile,
    deleteFile,
    getPoolStatus,

    // URL helpers
    getPreviewUrl,
    getDownloadUrl,

    // Misc
    clearError: () => setError(null),
  }
}

// =============================================================================
// FULL DRIVE UPLOAD RESULT — returned by useDriveUpload
// =============================================================================

export interface DriveUploadResult {
  fileUrl: string          // webViewLink — use for display / viewing
  downloadUrl: string      // webContentLink — use for direct downloads
  gdriveFileId: string
  poolAccountId: string
  accountEmail: string
  recordId: string
}

// =============================================================================
// SIMPLER STANDALONE HOOK: upload a file and get back the full Drive result
// =============================================================================

/**
 * Minimal hook for components that need to upload a file and get Drive metadata back.
 * Returns the full DriveUploadResult so callers can persist gdriveFileId, poolAccountId, etc.
 *
 * @example
 * const { uploadToDrive, uploading } = useDriveUpload()
 *
 * const result = await uploadToDrive(file, 'master_documents', {
 *   uploadedBy: user.role,
 *   entityId:   newDocId,
 *   entityType: 'master_document',
 * })
 * if (result) {
 *   // result.fileUrl, result.gdriveFileId, result.poolAccountId, result.recordId
 * }
 */
export function useDriveUpload() {
  const [uploading,   setUploading]   = useState(false)
  const [driveUrl,    setDriveUrl]    = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [progress,    setProgress]    = useState(0)
  const [error,       setError]       = useState<string | null>(null)

  const { uploadFile } = useGDrivePool()

  /**
   * Uploads a file and returns the full Drive result, or null on failure.
   * All Drive metadata (gdriveFileId, poolAccountId, recordId) is included
   * so callers can store it in Supabase alongside the document record.
   */
  const uploadToDrive = useCallback(async (
    file: File,
    category: DocumentCategory,
    meta: { uploadedBy: string; entityId?: string; entityType?: string }
  ): Promise<DriveUploadResult | null> => {
    setUploading(true)
    setDriveUrl(null)
    setDownloadUrl(null)
    setError(null)

    const result = await uploadFile({
      file,
      category,
      uploadedBy:  meta.uploadedBy,
      entityId:    meta.entityId,
      entityType:  meta.entityType,
      onProgress:  setProgress,
    })

    setUploading(false)

    if (
      result.success &&
      result.driveUrl &&
      result.gdriveFileId &&
      result.poolAccountId
    ) {
      setDriveUrl(result.driveUrl)
      setDownloadUrl(result.downloadUrl ?? null)
      return {
        fileUrl:       result.driveUrl,
        downloadUrl:   result.downloadUrl ?? '',
        gdriveFileId:  result.gdriveFileId,
        poolAccountId: result.poolAccountId,
        accountEmail:  result.accountEmail ?? '',
        recordId:      result.recordId     ?? '',
      }
    }

    setError(result.error ?? 'Upload failed.')
    return null
  }, [uploadFile])

  return {
    uploadToDrive,
    uploading,
    progress,
    driveUrl,
    downloadUrl,
    error,
    reset: () => {
      setDriveUrl(null)
      setDownloadUrl(null)
      setError(null)
      setProgress(0)
    },
  }
}



export interface UseDriveDeleteReturn {
  deleteFromDrive: (params: {
    gdriveFileId:  string
    poolAccountId: string
    recordId:      string
  }) => Promise<boolean>
  deleting: boolean
  error: string | null
}
 
export function useDriveDelete(): UseDriveDeleteReturn {
  const [deleting, setDeleting] = useState(false)
  const [error,    setError]    = useState<string | null>(null)
 
  const deleteFromDrive = useCallback(async (params: {
    gdriveFileId:  string
    poolAccountId: string
    recordId:      string
  }): Promise<boolean> => {
    setDeleting(true)
    setError(null)
 
    try {
      const response = await fetch('/api/gdrive/delete', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(params),
      })
 
      const json = await response.json()
 
      if (!response.ok || !json.data?.success) {
        setError(json.error ?? `Delete failed (HTTP ${response.status})`)
        return false
      }
 
      return true
    } catch (err: any) {
      setError(err?.message ?? 'Unexpected error during delete.')
      return false
    } finally {
      setDeleting(false)
    }
  }, [])
 
  return { deleteFromDrive, deleting, error }
}