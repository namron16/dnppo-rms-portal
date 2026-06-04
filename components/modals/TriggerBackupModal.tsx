'use client'

// components/modals/TriggerBackupModal.tsx
//
// Changes from original:
//   • After the API returns jobId the modal polls /api/backup/health every
//     3 s until the job reaches 'completed' or 'failed'.
//   • On completion it calls onSuccess(jobId) so the page can immediately
//     save the file to the local device without a second health fetch.
//   • Progress bar animates during the running phase.
//   • Error details are shown inline if the job fails.

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Play, X, CheckCircle2, XCircle, Loader2,
  AlertTriangle, Shield, Archive, Database,
  FileText, Activity, Calendar,
} from 'lucide-react'

interface BackupJob {
  id:            string
  module_name:   string
  status:        'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  download_url:  string | null
  error_message: string | null
  completed_at:  string | null
}

interface Props {
  open:      boolean
  onClose:   () => void
  /** Called with the completed jobId so the parent can trigger a local save */
  onSuccess: (jobId?: string) => void
}

const MODULE_OPTIONS = [
  { value: 'master_documents',     label: 'Master Documents',     icon: <FileText  size={14} /> },
  { value: 'admin_orders',         label: 'Admin Orders',         icon: <Archive   size={14} /> },
  { value: 'daily_journals',       label: 'Daily Journals',       icon: <Calendar  size={14} /> },
  { value: 'e_library',            label: 'E-Library',            icon: <Database  size={14} /> },
  { value: 'classified_documents', label: 'Classified Documents', icon: <Shield    size={14} /> },
  { value: 'archived_files',       label: 'Archived Files',       icon: <Archive   size={14} /> },
  { value: 'admin_logs',           label: 'Admin Logs',           icon: <Activity  size={14} /> },
  { value: 'personnel_201',        label: '201 Files',            icon: <FileText  size={14} /> },
  { value: 'organization',         label: 'Organization Chart',   icon: <Database  size={14} /> },
]

const BACKUP_TYPES = ['full', 'incremental', 'differential', 'manual'] as const

type Phase = 'idle' | 'submitting' | 'polling' | 'done' | 'error'

export function TriggerBackupModal({ open, onClose, onSuccess }: Props) {
  const [module_name,  setModuleName]  = useState('master_documents')
  const [backup_type,  setBackupType]  = useState<string>('full')
  const [phase,        setPhase]       = useState<Phase>('idle')
  const [errorMsg,     setErrorMsg]    = useState<string | null>(null)
  const [jobId,        setJobId]       = useState<string | null>(null)
  const [progress,     setProgress]    = useState(0)

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setPhase('idle')
      setErrorMsg(null)
      setJobId(null)
      setProgress(0)
    }
  }, [open])

  // Clean up intervals on unmount or close
  useEffect(() => {
    if (!open) {
      clearInterval(pollRef.current ?? undefined)
      clearInterval(progressRef.current ?? undefined)
    }
    return () => {
      clearInterval(pollRef.current ?? undefined)
      clearInterval(progressRef.current ?? undefined)
    }
  }, [open])

  // Animate progress bar during polling phase (fake progress, capped at 90%)
  useEffect(() => {
    if (phase === 'polling') {
      setProgress(10)
      progressRef.current = setInterval(() => {
        setProgress(p => p < 90 ? p + Math.random() * 4 : p)
      }, 800)
    } else {
      clearInterval(progressRef.current ?? undefined)
      if (phase === 'done')  setProgress(100)
      if (phase === 'error') setProgress(0)
    }
  }, [phase])

  // Poll /api/backup/health for the job status
  const startPolling = useCallback((id: string) => {
    setPhase('polling')
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch('/api/backup/health')
        const json = await res.json()
        const jobs: BackupJob[] = json.data?.recentJobs ?? []
        const job = jobs.find(j => j.id === id)

        if (!job) return // not in list yet — keep polling

        if (job.status === 'completed') {
          clearInterval(pollRef.current ?? undefined)
          setPhase('done')
          // Small delay so the user sees 100% before the modal closes
          setTimeout(() => onSuccess(id), 900)
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          clearInterval(pollRef.current ?? undefined)
          setPhase('error')
          setErrorMsg(job.error_message ?? `Job ${job.status}.`)
        }
      } catch {
        // Network blip — keep polling
      }
    }, 3000)
  }, [onSuccess])

  const handleSubmit = async () => {
    setPhase('submitting')
    setErrorMsg(null)

    try {
      const res  = await fetch('/api/backup/trigger', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ module_name, backup_type }),
      })
      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error ?? `Server error ${res.status}`)
      }

      const id: string = json.data?.jobId
      setJobId(id)
      startPolling(id)
    } catch (err: any) {
      setPhase('error')
      setErrorMsg(err.message)
    }
  }

  if (!open) return null

  const isRunning = phase === 'submitting' || phase === 'polling'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
              <Play size={14} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Run Backup</h2>
              <p className="text-[11px] text-slate-500">Trigger a manual backup job</p>
            </div>
          </div>
          {!isRunning && (
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center transition"
            >
              <X size={14} className="text-slate-500" />
            </button>
          )}
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Module picker */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Module
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {MODULE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => !isRunning && setModuleName(opt.value)}
                  disabled={isRunning}
                  className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-[11px] transition text-left ${
                    module_name === opt.value
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  } disabled:opacity-50`}
                >
                  <span className={module_name === opt.value ? 'text-white' : 'text-slate-400'}>
                    {opt.icon}
                  </span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Backup type */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              Backup Type
            </label>
            <div className="flex gap-1.5">
              {BACKUP_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => !isRunning && setBackupType(t)}
                  disabled={isRunning}
                  className={`flex-1 py-1.5 rounded-lg border text-[11px] capitalize transition ${
                    backup_type === t
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  } disabled:opacity-50`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Progress */}
          {(phase === 'submitting' || phase === 'polling' || phase === 'done') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {phase === 'submitting' && 'Starting job…'}
                  {phase === 'polling'    && 'Backup running…'}
                  {phase === 'done'       && 'Backup complete!'}
                </span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    phase === 'done' ? 'bg-emerald-400' : 'bg-slate-900'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              {jobId && (
                <p className="text-[10px] text-slate-400 font-mono">Job {jobId.slice(0, 8)}…</p>
              )}
            </div>
          )}

          {/* Success */}
          {phase === 'done' && (
            <div className="flex items-center gap-2.5 px-3.5 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
              <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
              <div>
                <p className="font-semibold">Backup completed successfully</p>
                <p className="text-[11px] text-emerald-600 mt-0.5">
                  Saving to local device if configured…
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800">
              <XCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Backup failed</p>
                <p className="text-[11px] text-red-600 mt-0.5 break-words">{errorMsg}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            disabled={isRunning}
            className="px-4 py-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 bg-white rounded-lg transition disabled:opacity-50"
          >
            {phase === 'done' || phase === 'error' ? 'Close' : 'Cancel'}
          </button>
          {phase === 'idle' || phase === 'error' ? (
            <button
              onClick={handleSubmit}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-white bg-slate-900 hover:bg-slate-800 rounded-lg font-semibold transition"
            >
              <Play size={12} />
              {phase === 'error' ? 'Retry' : 'Start Backup'}
            </button>
          ) : isRunning ? (
            <button
              disabled
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-white bg-slate-400 rounded-lg font-semibold cursor-not-allowed"
            >
              <Loader2 size={12} className="animate-spin" />
              Running…
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}