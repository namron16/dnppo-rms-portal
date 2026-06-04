'use client'

// components/modals/LocalStorageSetupModal.tsx
//
// Lets the admin configure (or change) the local folder where backup ZIPs
// are automatically saved.  Shows:
//   • Current folder name + last-save timestamp
//   • "Choose Folder" button  (FSA) or info text (non-FSA browsers)
//   • "Test Write" button to verify the folder is still accessible
//   • "Clear" button to remove the saved handle

import { useState, useEffect } from 'react'
import {
  HardDrive, FolderOpen, CheckCircle2, XCircle,
  AlertTriangle, Trash2, RefreshCw, X, Info,
} from 'lucide-react'
import {
  configureLocalBackupFolder,
  getLocalBackupConfig,
  clearLocalBackupConfig,
  verifyLocalBackupFolder,
  isFSASupported,
  type LocalStorageConfig,
} from '@/lib/backup/local-storage'

interface Props {
  open:    boolean
  onClose: () => void
  /** Called after config is saved/cleared so the parent can refresh state */
  onChange?: (config: LocalStorageConfig | null) => void
}

type VerifyState = 'idle' | 'checking' | 'ok' | 'fail'

export function LocalStorageSetupModal({ open, onClose, onChange }: Props) {
  const [config,      setConfig]      = useState<LocalStorageConfig | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [choosing,    setChoosing]    = useState(false)
  const [verifyState, setVerifyState] = useState<VerifyState>('idle')
  const [error,       setError]       = useState<string | null>(null)

  // Load current config on open
  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    getLocalBackupConfig()
      .then(c => { setConfig(c); setLoading(false) })
      .catch(() => setLoading(false))
  }, [open])

  if (!open) return null

  const fsa = isFSASupported()

  const handleChoose = async () => {
    setChoosing(true)
    setError(null)
    try {
      const c = await configureLocalBackupFolder()
      if (c) {
        setConfig(c)
        onChange?.(c)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setChoosing(false)
    }
  }

  const handleVerify = async () => {
    setVerifyState('checking')
    const ok = await verifyLocalBackupFolder()
    setVerifyState(ok ? 'ok' : 'fail')
    setTimeout(() => setVerifyState('idle'), 3000)
  }

  const handleClear = async () => {
    await clearLocalBackupConfig()
    setConfig(null)
    onChange?.(null)
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-PH', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
              <HardDrive size={15} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Local Backup Storage</h2>
              <p className="text-[11px] text-slate-500">Configure where backups are saved on this device</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center transition"
          >
            <X size={14} className="text-slate-500" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Browser support notice */}
          {!fsa && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
              <div>
                <p className="font-semibold mb-0.5">Limited browser support</p>
                <p>
                  Your browser doesn't support the File System Access API (Chrome/Edge 86+
                  required for direct folder access). Backups will be saved via your browser's
                  standard download dialog instead.
                </p>
              </div>
            </div>
          )}

          {/* Current config */}
          {loading ? (
            <div className="h-20 rounded-xl bg-slate-50 animate-pulse border border-slate-200" />
          ) : config ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderOpen size={15} className="text-slate-500" />
                  <span className="text-xs font-semibold text-slate-900 truncate max-w-[200px]">
                    {config.folderName}
                  </span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  config.isValidated
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}>
                  {config.isValidated ? 'Verified' : 'Unverified'}
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                Last tested: {formatDate(config.lastTestedAt)}
              </div>

              {/* Verify result */}
              {verifyState === 'ok' && (
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-600">
                  <CheckCircle2 size={12} /> Folder is accessible and writable
                </div>
              )}
              {verifyState === 'fail' && (
                <div className="flex items-center gap-1.5 text-[11px] text-red-600">
                  <XCircle size={12} /> Folder is not accessible — please reconfigure
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
              <HardDrive size={24} className="mx-auto text-slate-300 mb-2" />
              <p className="text-xs text-slate-500">No local backup folder configured</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Backups are stored in Supabase Storage only
              </p>
            </div>
          )}

          {/* Info box */}
          <div className="flex items-start gap-2.5 px-3.5 py-3 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-800">
            <Info size={14} className="mt-0.5 shrink-0 text-sky-500" />
            <div className="space-y-1">
              <p>
                <span className="font-semibold">Manual backups</span> are saved immediately
                after the job completes.
              </p>
              <p>
                <span className="font-semibold">Scheduled / cron backups</span> are saved
                automatically the next time this page is opened (or while it's open).
              </p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              <XCircle size={13} />
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            {config && (
              <>
                <button
                  onClick={handleVerify}
                  disabled={verifyState === 'checking'}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 bg-white hover:bg-slate-50 rounded-lg transition"
                >
                  <RefreshCw size={12} className={verifyState === 'checking' ? 'animate-spin' : ''} />
                  Test
                </button>
                <button
                  onClick={handleClear}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 hover:text-red-700 border border-red-200 bg-white hover:bg-red-50 rounded-lg transition"
                >
                  <Trash2 size={12} />
                  Clear
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 bg-white rounded-lg transition"
            >
              Close
            </button>
            <button
              onClick={handleChoose}
              disabled={choosing}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-white bg-slate-900 hover:bg-slate-800 rounded-lg font-semibold transition disabled:opacity-60"
            >
              <FolderOpen size={12} />
              {choosing ? 'Choosing…' : config ? 'Change Folder' : 'Choose Folder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}