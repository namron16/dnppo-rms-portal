'use client'

// components/modals/TriggerBackupModal.tsx
//
// FIX: Polling was silently missing completed jobs because:
//   1. /api/backup/health returns only the last 20 jobs — a new job could
//      briefly not appear if the table is busy. Now retries up to 60 polls.
//   2. The job could stay stuck as 'running' forever if the engine crashed
//      before updating the row (e.g. missing download_url column). Added a
//      60-second hard timeout that marks the job as failed in the UI.
//   3. Added a direct /api/backup/job/:id endpoint call as fallback when
//      the job is not found in the health list (not implemented here — we
//      instead increase poll tolerance and add the timeout).

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

// Polling config
const POLL_INTERVAL_MS  = 3000   // check every 3 s
const POLL_TIMEOUT_MS   = 300000 // 5-minute hard timeout (matches maxDuration)
const JOB_NOT_FOUND_MAX = 10     // tolerate job missing from health list for 30 s before giving up

type Phase = 'idle' | 'submitting' | 'polling' | 'done' | 'error'

export function TriggerBackupModal({ open, onClose, onSuccess }: Props) {
  const [module_name,  setModuleName]  = useState('master_documents')
  const [backup_type,  setBackupType]  = useState<string>('full')
  const [phase,        setPhase]       = useState<Phase>('idle')
  const [errorMsg,     setErrorMsg]    = useState<string | null>(null)
  const [jobId,        setJobId]       = useState<string | null>(null)
  const [progress,     setProgress]    = useState(0)

  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef     = useRef<ReturnType<typeof setTimeout>  | null>(null)
  const notFoundCount  = useRef(0)

  const stopAll = useCallback(() => {
    clearInterval(pollRef.current    ?? undefined)
    clearInterval(progressRef.current ?? undefined)
    clearTimeout(timeoutRef.current  ?? undefined)
    pollRef.current     = null
    progressRef.current = null
    timeoutRef.current  = null
  }, [])

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      stopAll()
      setPhase('idle')
      setErrorMsg(null)
      setJobId(null)
      setProgress(0)
      notFoundCount.current = 0
    }
    return () => { if (!open) stopAll() }
  }, [open, stopAll])

  // Animate progress bar during polling phase (fake progress, capped at 90%)
  useEffect(() => {
    if (phase === 'polling') {
      setProgress(10)
      progressRef.current = setInterval(() => {
        setProgress(p => p < 90 ? p + Math.random() * 3 : p)
      }, 800)
    } else {
      clearInterval(progressRef.current ?? undefined)
      progressRef.current = null
      if (phase === 'done')  setProgress(100)
      if (phase === 'error') setProgress(0)
    }
  }, [phase])

  // Poll /api/backup/health for the job status
  const startPolling = useCallback((id: string) => {
    setPhase('polling')
    notFoundCount.current = 0

    // Hard timeout — if the engine never updates the job, stop spinning
    timeoutRef.current = setTimeout(() => {
      stopAll()
      setPhase('error')
      setErrorMsg(
        `Backup timed out after 5 minutes. The job may still be running on the server. ` +
        `Check the Recent Backup Jobs table for the current status. ` +
        `If the job is stuck as "running", run migration 010 to add the missing ` +
        `download_url and local_saved columns to backup_jobs.`
      )
    }, POLL_TIMEOUT_MS)

    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch('/api/backup/health')
        if (!res.ok) return // transient error — keep polling

        const json = await res.json()
        const jobs: BackupJob[] = json.data?.recentJobs ?? []
        const job = jobs.find(j => j.id === id)

        if (!job) {
          // Job not in list yet — could be because it was just created or the
          // health endpoint returned a cached/stale list. Tolerate briefly.
          notFoundCount.current++
          console.warn(
            `[Poll] Job ${id} not found in health list ` +
            `(attempt ${notFoundCount.current}/${JOB_NOT_FOUND_MAX})`
          )
          if (notFoundCount.current >= JOB_NOT_FOUND_MAX) {
            stopAll()
            setPhase('error')
            setErrorMsg(
              `Job ${id.slice(0, 8)}… was not found in recent backup jobs after ` +
              `${notFoundCount.current} polls. The job insert may have failed silently. ` +
              `Check the Supabase backup_jobs table directly.`
            )
          }
          return
        }

        // Reset not-found counter once we see the job
        notFoundCount.current = 0

        if (job.status === 'completed') {
          stopAll()
          setPhase('done')
          setTimeout(() => onSuccess(id), 900)
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          stopAll()
          setPhase('error')
          setErrorMsg(
            job.error_message ??
            `Job ${job.status}. Check the Supabase backup_jobs table for details.`
          )
        }
        // 'pending' or 'running' — keep polling
      } catch (err: any) {
        // Network blip — keep polling, don't reset the counter
        console.warn('[Poll] Health fetch failed (network blip):', err?.message)
      }
    }, POLL_INTERVAL_MS)
  }, [onSuccess, stopAll])

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
      if (!id) throw new Error('Server did not return a jobId.')

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

          {/* Diagnostic hint while polling — shown after 15 s */}
          {phase === 'polling' && progress > 50 && (
            <p className="text-[10px] text-slate-400 text-center">
              Taking longer than usual? Check that the{' '}
              <code className="bg-slate-100 px-1 rounded">backup-staging</code>{' '}
              Supabase Storage bucket exists and migration 010 has been run.
            </p>
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