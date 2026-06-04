// lib/backup/local-storage.ts
//
// Local device storage for backup ZIPs.
//
// HOW IT WORKS:
//   The File System Access API (FSA) lets the browser write directly to a
//   folder the admin selects. The directory handle is persisted in IndexedDB
//   via the browser's own origin-storage so it survives page reloads and
//   browser restarts (the browser re-prompts for permission if the OS requires
//   it, but the path is remembered).
//
// SCHEDULED / CRON BACKUPS:
//   The cron job runs on the server and has no access to the browser. After a
//   cron backup completes the engine stores a signed download_url in
//   backup_jobs. When the admin's browser tab is open (or when they next open
//   the Backup & Recovery page) the page polls for jobs that are:
//     • status = 'completed'
//     • local_saved = false   (new column — see migration note below)
//   and auto-downloads each one to the configured local folder.
//
// MANUAL BACKUPS:
//   The trigger API returns { jobId, status: 'running' }. The page polls
//   that job until completed, then calls saveBackupFromUrl() directly.
//
// MIGRATION NOTE:
//   Add a boolean column to backup_jobs:
//     ALTER TABLE backup_jobs ADD COLUMN IF NOT EXISTS local_saved BOOLEAN DEFAULT FALSE;
//   The page marks it true after a successful local save so it is never
//   downloaded twice.
//
// BROWSER SUPPORT:
//   FSA is available in Chrome/Edge 86+, Opera 72+.
//   Firefox and Safari do NOT support showDirectoryPicker().
//   On unsupported browsers the code falls back to a standard <a> download,
//   which triggers the browser's own save dialog.

const DB_NAME    = 'rms_backup_storage'
const DB_VERSION = 1
const STORE_NAME = 'handles'
const HANDLE_KEY = 'backup_dir'

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function saveHandleToDb(handle: FileSystemDirectoryHandle): Promise<void> {
  const db  = await openHandleDb()
  const tx  = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY)
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

async function loadHandleFromDb(): Promise<FileSystemDirectoryHandle | null> {
  const db  = await openHandleDb()
  const tx  = db.transaction(STORE_NAME, 'readonly')
  const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY)
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null)
    req.onerror   = () => reject(req.error)
  })
}

async function clearHandleFromDb(): Promise<void> {
  const db = await openHandleDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).delete(HANDLE_KEY)
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface LocalStorageConfig {
  /** Display name of the selected folder (e.g. "PNP_Backups") */
  folderName:    string
  /** Whether the handle was verified writable at config time */
  isValidated:   boolean
  /** ISO timestamp of last successful write test */
  lastTestedAt:  string | null
  /** True if the browser supports the File System Access API */
  fsa_supported: boolean
}

export interface SaveResult {
  success:   boolean
  fileName?: string
  error?:    string
  /** True if the fallback browser-download was used (no FSA) */
  usedFallback?: boolean
}

// ── FSA feature detection ─────────────────────────────────────────────────────

export function isFSASupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Opens a directory picker, tests write permission, and persists the handle
 * to IndexedDB so it survives page reloads.
 *
 * Returns null if the user cancels the picker.
 */
export async function configureLocalBackupFolder(): Promise<LocalStorageConfig | null> {
  if (!isFSASupported()) {
    // Non-FSA browsers: remember a user-typed path display string only.
    // Actual saving will use browser download fallback.
    return {
      folderName:    'Downloads (browser default)',
      isValidated:   false,
      lastTestedAt:  null,
      fsa_supported: false,
    }
  }

  try {
    const handle = await (window as any).showDirectoryPicker({
      mode:    'readwrite',
      startIn: 'documents',
      id:      'rms-backups',
    }) as FileSystemDirectoryHandle

    // Test write permission
    const testName = '_rms_write_test.tmp'
    const testFile = await handle.getFileHandle(testName, { create: true })
    const writable = await (testFile as any).createWritable()
    await writable.write('ok')
    await writable.close()
    await handle.removeEntry(testName)

    await saveHandleToDb(handle)

    return {
      folderName:    handle.name,
      isValidated:   true,
      lastTestedAt:  new Date().toISOString(),
      fsa_supported: true,
    }
  } catch (err: any) {
    if (err.name === 'AbortError') return null
    throw new Error(`Cannot access selected folder: ${err.message}`)
  }
}

/**
 * Returns the persisted config (folder name + FSA support flag) without
 * opening the picker. Returns null if no folder has been configured.
 */
export async function getLocalBackupConfig(): Promise<LocalStorageConfig | null> {
  const fsa = isFSASupported()

  if (!fsa) {
    // Check localStorage for a user-typed path saved by the settings modal
    const saved = localStorage.getItem('rms_backup_folder_name')
    if (!saved) return null
    return {
      folderName:    saved,
      isValidated:   false,
      lastTestedAt:  null,
      fsa_supported: false,
    }
  }

  const handle = await loadHandleFromDb()
  if (!handle) return null

  return {
    folderName:    handle.name,
    isValidated:   true,
    lastTestedAt:  localStorage.getItem('rms_backup_last_tested'),
    fsa_supported: true,
  }
}

/**
 * Clears the persisted folder handle. Admin will need to re-configure.
 */
export async function clearLocalBackupConfig(): Promise<void> {
  await clearHandleFromDb()
  localStorage.removeItem('rms_backup_folder_name')
  localStorage.removeItem('rms_backup_last_tested')
}

/**
 * Verifies the persisted handle is still accessible and writable.
 * Returns false if the user has revoked permission or the folder was deleted.
 */
export async function verifyLocalBackupFolder(): Promise<boolean> {
  if (!isFSASupported()) return false

  try {
    const handle = await loadHandleFromDb()
    if (!handle) return false

    const permStatus = await (handle as any).queryPermission({ mode: 'readwrite' })
    if (permStatus === 'granted') return true

    // Try to re-request (will show browser permission prompt if needed)
    const req = await (handle as any).requestPermission({ mode: 'readwrite' })
    return req === 'granted'
  } catch {
    return false
  }
}

// ── Core save function ────────────────────────────────────────────────────────

/**
 * Downloads a backup ZIP from `url` and saves it to the configured local
 * folder. Falls back to a browser download if FSA is not available or not
 * configured.
 *
 * @param url       Signed URL from backup_jobs.download_url
 * @param fileName  Desired file name, e.g. "Backup_2025-06-01_02-00-AM_MasterDocuments.zip"
 */
export async function saveBackupFromUrl(
  url:      string,
  fileName: string
): Promise<SaveResult> {
  // ── Dev mode guard ────────────────────────────────────────────────────────
  // When BACKUP_DEV_MODE=true the engine stores a file:// path in
  // download_url (e.g. "file:///tmp/Backup_...zip").  Browsers block fetch()
  // to file:// URLs via CSP, and the file lives on the server's /tmp anyway
  // so the browser couldn't read it even without CSP.
  // Skip the fetch entirely and return a clear dev-mode notice.
  if (url.startsWith('file://')) {
    console.info(
      '[LocalStorage] Dev mode detected (file:// URL). ' +
      'Local save is skipped — the ZIP lives in the server /tmp folder, not on this device. ' +
      'Set BACKUP_DEV_MODE=false (or unset it) and use real Supabase Storage to test local saves.'
    )
    return {
      success:      false,
      usedFallback: false,
      error:
        'Dev mode: backup ZIP is on the server (/tmp), not downloadable to this device. ' +
        'Disable BACKUP_DEV_MODE to enable local saves.',
    }
  }

  // ── Production: fetch from Supabase Storage signed URL ───────────────────
  let blob: Blob
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    blob = await response.blob()
  } catch (err: any) {
    return { success: false, error: `Failed to download backup ZIP: ${err.message}` }
  }

  return saveBackupBlob({ blob, fileName })
}

/**
 * Saves a Blob (already in memory) to the configured local folder.
 * Used when the backup engine runs in-browser (dev mode or future streaming).
 */
export async function saveBackupBlob(params: {
  blob:     Blob
  fileName: string
}): Promise<SaveResult> {
  const { blob, fileName } = params

  // ── FSA path ──────────────────────────────────────────────────────────────
  if (isFSASupported()) {
    try {
      const handle = await loadHandleFromDb()

      if (handle) {
        // Re-request permission if needed (browser may have suspended it)
        const perm = await (handle as any).requestPermission({ mode: 'readwrite' })
        if (perm !== 'granted') {
          throw new Error('Write permission denied for the backup folder.')
        }

        const fileHandle = await handle.getFileHandle(fileName, { create: true })
        const writable   = await (fileHandle as any).createWritable()
        await writable.write(blob)
        await writable.close()

        // Stamp last-tested so the UI can show "last saved X ago"
        localStorage.setItem('rms_backup_last_tested', new Date().toISOString())

        return { success: true, fileName }
      }
    } catch (err: any) {
      // Fall through to browser download fallback — don't silently lose the file
      console.warn('[LocalStorage] FSA write failed, falling back to download:', err.message)
    }
  }

  // ── Browser download fallback ─────────────────────────────────────────────
  try {
    triggerBrowserDownload(blob, fileName)
    return { success: true, fileName, usedFallback: true }
  } catch (err: any) {
    return { success: false, error: `Fallback download failed: ${err.message}` }
  }
}

// ── Pending backup queue (for cron / scheduled backups) ───────────────────────

/**
 * Fetches backup jobs that completed successfully but haven't been saved
 * locally yet (local_saved = false).
 *
 * Call this when the Backup & Recovery page loads so scheduled backups that
 * ran while the browser was closed get saved automatically.
 */
export async function fetchPendingLocalSaves(): Promise<Array<{
  id:           string
  module_name:  string
  download_url: string
  folderName:   string
  completed_at: string
}>> {
  try {
    const res  = await fetch('/api/backup/pending-local-saves')
    const json = await res.json()
    return json.data ?? []
  } catch {
    return []
  }
}

/**
 * Marks a job as locally saved in the database so it is never re-downloaded.
 */
export async function markJobLocalSaved(jobId: string): Promise<void> {
  await fetch('/api/backup/mark-local-saved', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jobId }),
  })
}

/**
 * Processes the pending-save queue:
 *   1. Fetches all jobs with local_saved = false
 *   2. Downloads and saves each one to the configured local folder
 *   3. Marks each job local_saved = true
 *
 * Safe to call on every page load — does nothing if no pending jobs or no
 * folder configured.
 *
 * @param onProgress  Optional callback called after each file is saved.
 */
export async function processPendingLocalSaves(onProgress?: (
  result: SaveResult & { jobId: string; module_name: string }
) => void): Promise<void> {
  const config = await getLocalBackupConfig()
  if (!config) return // No folder configured — nothing to do

  const pending = await fetchPendingLocalSaves()
  if (pending.length === 0) return

  console.log(`[LocalStorage] Processing ${pending.length} pending local save(s)…`)

  for (const job of pending) {
    const fileName = `${job.folderName}.zip`

    const result = await saveBackupFromUrl(job.download_url, fileName)

    if (result.success) {
      await markJobLocalSaved(job.id)
      console.log(`[LocalStorage] Saved: ${fileName}`)
    } else {
      console.warn(`[LocalStorage] Failed to save job ${job.id}:`, result.error)
    }

    onProgress?.({ ...result, jobId: job.id, module_name: job.module_name })
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a   = Object.assign(document.createElement('a'), {
    href:     url,
    download: fileName,
  })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}