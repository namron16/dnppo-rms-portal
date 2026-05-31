'use client'

import { useState } from 'react'
import { Play, X, AlertTriangle, Shield, CheckCircle2, ChevronDown, Info } from 'lucide-react'

const MODULES = [
  { key: 'master_documents',     label: 'Master Documents',    encrypted: false },
  { key: 'admin_orders',         label: 'Admin Orders',        encrypted: false },
  { key: 'daily_journals',       label: 'Daily Journals',      encrypted: false },
  { key: 'e_library',            label: 'E-Library',           encrypted: false },
  { key: 'classified_documents', label: 'Classified Documents',encrypted: true  },
  { key: 'archived_files',       label: 'Archived Files',      encrypted: false },
  { key: 'admin_logs',           label: 'Admin Logs',          encrypted: false },
  { key: 'personnel_201',        label: '201 Files',           encrypted: false },
  { key: 'organization',         label: 'Organization Chart',  encrypted: false },
]

const BACKUP_TYPES = ['full', 'incremental', 'differential', 'manual'] as const

interface ApiError {
  error:   string
  code?:   string
  detail?: string
}

interface Props {
  open:      boolean
  onClose:   () => void
  onSuccess: () => void
}

export function TriggerBackupModal({ open, onClose, onSuccess }: Props) {
  const [module_name, setModuleName] = useState('')
  const [backup_type, setBackupType] = useState<typeof BACKUP_TYPES[number]>('full')
  const [loading,     setLoading]    = useState(false)
  const [apiError,    setApiError]   = useState<ApiError | null>(null)
  const [showDetail,  setShowDetail] = useState(false)
  const [result,      setResult]     = useState<{ jobId: string; message: string } | null>(null)

  if (!open) return null

  const selectedMod = MODULES.find(m => m.key === module_name)

  const handleSubmit = async () => {
    if (!module_name) {
      setApiError({ error: 'Please select a module.', code: 'MISSING_MODULE' })
      return
    }
    setApiError(null)
    setShowDetail(false)
    setLoading(true)

    try {
      const res  = await fetch('/api/backup/trigger', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ module_name, backup_type }),
      })
      const json = await res.json()

      if (!res.ok) {
        // Store the full structured error from the API
        setApiError({
          error:  json.error  ?? 'Backup failed to start.',
          code:   json.code   ?? `HTTP_${res.status}`,
          detail: json.detail ?? null,
        })
        return
      }

      setResult({ jobId: json.data.jobId, message: json.data.message })
    } catch (e: any) {
      setApiError({
        error:  'Could not reach the backup API.',
        code:   'NETWORK_ERROR',
        detail: e?.message ?? String(e),
      })
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setModuleName('')
    setBackupType('full')
    setApiError(null)
    setShowDetail(false)
    setResult(null)
    setLoading(false)
    onClose()
  }

  const handleDone = () => { handleClose(); onSuccess() }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <Play size={15} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Run Manual Backup</h2>
              <p className="text-[11px] text-slate-500">Triggered as Super Admin</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-slate-500 hover:text-slate-900 transition">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">

          {result ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 size={24} className="text-emerald-500" />
                </div>
                <p className="text-sm font-semibold text-slate-900 text-center">{result.message}</p>
                <p className="text-[11px] text-slate-500 font-mono bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                  Job ID: {result.jobId}
                </p>
              </div>
              <button
                onClick={handleDone}
                className="w-full py-2.5 text-sm font-semibold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-xl transition"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Module Select */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Module</label>
                <div className="grid grid-cols-2 gap-2">
                  {MODULES.map(m => (
                    <button
                      key={m.key}
                      onClick={() => setModuleName(m.key)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-[12px] border transition text-left ${
                        module_name === m.key
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900'
                      }`}
                    >
                      {m.encrypted && (
                        <Shield size={11} className="text-amber-400 shrink-0" />
                      )}
                      <span className="truncate">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Backup Type */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Backup Type</label>
                <div className="flex gap-2">
                  {BACKUP_TYPES.map(t => (
                    <button
                      key={t}
                      onClick={() => setBackupType(t)}
                      className={`flex-1 py-2 text-[11px] capitalize rounded-lg border transition font-medium ${
                        backup_type === t
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Classified warning */}
              {selectedMod?.encrypted && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  This module uses double AES-256-GCM encryption. Ensure{' '}
                  <code className="font-mono">CLASSIFIED_BACKUP_SECRET</code> is set.
                </div>
              )}

              {/* ── Error block — shows code + expandable detail ── */}
              {apiError && (
                <div className="rounded-xl border border-red-200 bg-red-50 overflow-hidden">
                  <div className="flex items-start gap-2 px-3 py-2.5">
                    <AlertTriangle size={13} className="text-red-500 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-red-700 font-medium">{apiError.error}</p>
                      {apiError.code && (
                        <p className="text-[10px] text-red-500 font-mono mt-0.5">
                          code: {apiError.code}
                        </p>
                      )}
                    </div>
                    {apiError.detail && (
                      <button
                        onClick={() => setShowDetail(v => !v)}
                        className="shrink-0 text-red-400 hover:text-red-600 transition"
                        title="Toggle detail"
                      >
                        <Info size={13} />
                      </button>
                    )}
                  </div>
                  {showDetail && apiError.detail && (
                    <div className="px-3 pb-2.5 border-t border-red-200">
                      <p className="text-[11px] text-red-600 font-mono break-all mt-2">
                        {apiError.detail}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={loading || !module_name}
                className="w-full py-2.5 text-sm font-semibold text-slate-900 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 rounded-xl transition flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin" />
                    Starting backup…
                  </>
                ) : (
                  <><Play size={14} /> Start Backup</>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}