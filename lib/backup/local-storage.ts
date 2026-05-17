// lib/backup/local-storage.ts

export interface BackupDestinationConfig {
  path: string           // Display path shown to admin
  handle?: FileSystemDirectoryHandle  // FSA API handle (if supported)
  isValidated: boolean
  lastTestedAt: string | null
}

/**
 * Opens a directory picker and returns a handle + display path.
 * Falls back to triggering a download if FSA is not supported.
 */
export async function selectBackupDestination(): Promise<BackupDestinationConfig | null> {
  if (!('showDirectoryPicker' in window)) {
    // Fallback: directory path is user-typed; backup downloads as .zip
    return {
      path: getDefaultBackupPath(),
      isValidated: false,
      lastTestedAt: null,
    }
  }

  try {
    const handle = await (window as any).showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents',
    })

    // Test write permission
    const testFile = await handle.getFileHandle('_rms_write_test.tmp', { create: true })
    await handle.removeEntry('_rms_write_test.tmp')

    return {
      path: handle.name,
      handle,
      isValidated: true,
      lastTestedAt: new Date().toISOString(),
    }
  } catch (err: any) {
    if (err.name === 'AbortError') return null
    throw new Error(`Cannot write to selected folder: ${err.message}`)
  }
}

/**
 * Saves a backup ZIP blob to the selected directory using FSA API,
 * or triggers a browser download as fallback.
 */
export async function saveBackupToLocal(params: {
  blob: Blob
  fileName: string
  handle?: FileSystemDirectoryHandle
}): Promise<void> {
  const { blob, fileName, handle } = params

  if (handle) {
    // FSA API — write directly to folder
    const fileHandle = await handle.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(blob)
    await writable.close()
    return
  }

  // Fallback: trigger browser download
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

function getDefaultBackupPath(): string {
  return 'PNP_Backups'
}