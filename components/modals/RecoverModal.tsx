'use client'

import { useState, useEffect } from 'react'
import { RotateCcw, X, AlertTriangle, CheckCircle2, Shield, ChevronDown } from 'lucide-react'

const MODULE_LABELS: Record<string, string> = {
  master_documents:    'Master Documents',
  admin_orders:        'Admin Orders',
  daily_journals:      'Daily Journals',
  e_library:           'E-Library',
  classified_documents:'Classified Documents',
  archived_files:      'Archived Files',
  admin_logs:          'Admin Logs',
  personnel_201:       '201 Files',
  organization:        'Organization Chart',
}

interface BackupJob {
  id:            string
  module_name:   string
  status:        string
  backup_type:   string
  started_at:    string | null
  completed_at:  string | null
  total_size_bytes: number | null
}

interface RecoveryResult {
  recoveryJobId:    string
  recordsRestored:  number
  filesRestored:    number
  validationPassed: boolean
  durationSecs:     number
}

interface Props {
  open:          boolean
  onClose:       () => void
  onSuccess:     () => void
  defaultModule: string
  recentJobs:    BackupJob[]
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}

export function RecoverModal({ open, onClose, onSuccess, defaultModule, recentJobs }: Props) {
  const [module_name, setModuleName] = useState(defaultModule)
  const [selectedJob, setSelectedJob] = useState<BackupJob | null>(null)
  const [confirmed,   setConfirmed]   = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [result,      setResult]      = useState<RecoveryResult | null>(null)

  useEffect(() => {
    if (open) {
      setModuleName(defaultModule)
      setSelectedJob(null)
      setConfirmed(false)
      setError(null)
      setResult(null)
    }
  }, [open, defaultModule])

  useEffect(() => {
    // Auto-select the latest completed job for the chosen module
    if (module_name) {
      const latest = recentJobs
        .filter(j => j.module_name === module_name && j.status === 'completed')
        .sort((a, b) => new Date(b.completed_at ?? 0).getTime() - new Date(a.completed_at ?? 0).getTime())[0]
      setSelectedJob(latest ?? null)
    }
  }, [module_name, recentJobs])

  if (!open) return null

  const moduleJobs = recentJobs.filter(j => j.module_name === module_name && j.status === 'completed')

  const handleRecover = async () => {
    if (!selectedJob) { setError('No completed backup selected.'); return }
    if (!confirmed)   { setError('You must confirm to proceed.'); return }
    setError(null)
    setLoading(true)
    try {
      const res  = await fetch('/api/backup/recover', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          backup_job_id: selectedJob.id,
          module_name,
          confirm: true,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Recovery failed')
      setResult(json.data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setModuleName(''); setSelectedJob(null)
    setConfirmed(false); setError(null); setResult(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <RotateCcw size={15} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Restore from Backup</h2>
              <p className="text-[11px] text-slate-500">Super Admin operation — creates rollback snapshot first</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-slate-500 hover:text-slate-900 transition">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {result ? (
            /* ── Success State ── */
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3 py-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  result.validationPassed ? 'bg-emerald-50' : 'bg-amber-50'
                }`}>
                  {result.validationPassed
                    ? <CheckCircle2 size={24} className="text-emerald-600" />
                    : <AlertTriangle size={24} className="text-amber-600" />
                  }
                </div>
                <p className="text-sm font-semibold text-slate-900">
                  {result.validationPassed ? 'Recovery Successful' : 'Recovery Completed with Warnings'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <Stat label="Records Restored" value={result.recordsRestored} />
                <Stat label="Files Restored"   value={result.filesRestored} />
                <Stat label="Duration"         value={`${result.durationSecs}s`} />
                <Stat label="Validation"       value={result.validationPassed ? '✓ Passed' : '⚠ Failed'} />
              </div>
              <p className="text-[11px] text-slate-500 font-mono bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                Recovery ID: {result.recoveryJobId}
              </p>
              <button
                onClick={() => { handleClose(); onSuccess() }}
                className="w-full py-2.5 text-sm font-semibold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-xl transition"
              >
                Done
              </button>
            </div>
          ) : (
            /* ── Form State ── */
            <>
              {/* Warning Banner */}
              <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
                <AlertTriangle size={15} className="text-red-600 mt-0.5 shrink-0" />
                <div className="text-[11px] text-red-700 space-y-0.5">
                  <p className="font-bold">This will overwrite existing data.</p>
                  <p className="text-red-600/80">A rollback snapshot will be created automatically before recovery begins. This operation is logged.</p>
                </div>
              </div>

              {/* Module Select */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Module to Restore</label>
                <div className="relative">
                  <select
                    value={module_name}
                    onChange={e => setModuleName(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-900 appearance-none focus:outline-none focus:border-slate-400 transition"
                  >
                    <option value="" disabled className="bg-white">Select module…</option>
                    {Object.entries(MODULE_LABELS).map(([k, v]) => (
                      <option key={k} value={k} className="bg-white">{v}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>

              {/* Job Select */}
              {module_name && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Restore Point ({moduleJobs.length} available)
                  </label>
                  {moduleJobs.length === 0 ? (
                    <div className="text-center py-4 text-[12px] text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                      No completed backups found for this module
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                      {moduleJobs.map(job => (
                        <button
                          key={job.id}
                          onClick={() => setSelectedJob(job)}
                          className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition ${
                            selectedJob?.id === job.id
                              ? 'bg-slate-900 border-slate-900'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="space-y-0.5">
                            <p className="text-[12px] font-semibold text-slate-900 capitalize">{job.backup_type} backup</p>
                            <p className="text-[11px] text-slate-400">{fmt(job.completed_at)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[11px] text-slate-600">{formatBytes(job.total_size_bytes)}</p>
                            {selectedJob?.id === job.id && (
                              <Shield size={11} className="text-amber-400 ml-auto mt-1" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Confirmation */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={e => setConfirmed(e.target.checked)}
                  className="mt-0.5 accent-amber-500 w-4 h-4 rounded"
                />
                <span className="text-[12px] text-slate-700">
                  I understand this will overwrite current data for <strong className="text-slate-900">{(MODULE_LABELS[module_name] ?? module_name) || '—'}</strong> and acknowledge that a rollback snapshot will be created.
                </span>
              </label>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-[11px] text-red-700">
                  <AlertTriangle size={13} /> {error}
                </div>
              )}

              <button
                onClick={handleRecover}
                disabled={loading || !selectedJob || !confirmed}
                className="w-full py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl transition flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Recovering…
                  </>
                ) : (
                  <><RotateCcw size={14} /> Confirm Restore</>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
      <p className="text-[10px] text-slate-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-slate-900">{value}</p>
    </div>
  )
}