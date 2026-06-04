'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import {
  Shield, Database, Clock, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, Play, RotateCcw, Bell,
  HardDrive, Zap, Calendar, ChevronRight, Download,
  Settings, Archive, FileText, Activity, FolderOpen,
} from 'lucide-react'

import { TriggerBackupModal }    from '@/components/modals/TriggerBackupModal'
import { RecoverModal }          from '@/components/modals/RecoverModal'
import { ScheduleModal }         from '@/components/modals/ScheduleModal'
import { NotificationsModal, JobDetailModal } from '@/components/modals/NotificationsModal'
import { LocalStorageSetupModal } from '@/components/modals/LocalStorageSetupModal'

import {
  getLocalBackupConfig,
  processPendingLocalSaves,
  saveBackupFromUrl,
  markJobLocalSaved,
  type LocalStorageConfig,
  type SaveResult,
} from '@/lib/backup/local-storage'

// ── Types ─────────────────────────────────────────────────────────────────────

interface HealthSummary {
  total_backups:      number
  successful_backups: number
  failed_backups:     number
  last_success_at:    string | null
  last_failure_at:    string | null
  total_size_gb:      number
  health_score:       number
  recovery_ready:     boolean
}

interface BackupJob {
  id:               string
  module_name:      string
  status:           'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  backup_type:      string
  frequency:        string
  started_at:       string | null
  completed_at:     string | null
  total_size_bytes: number | null
  error_message:    string | null
  download_url:     string | null
}

interface ModuleStatus {
  module_name:         string
  is_enabled:          boolean
  frequency:           string
  backup_hour:         number | null
  backup_type:         string | null
  include_attachments: boolean | null
  encrypt_backup:      boolean | null
  retention_days:      number | null
  custom_cron:         string | null
  last_configured_at:  string | null
}

interface HealthData {
  summary:             HealthSummary
  recentJobs:          BackupJob[]
  moduleStatus:        ModuleStatus[]
  unreadNotifications: number
}

// local-save toast entry
interface LocalSaveToast {
  id:          string
  module_name: string
  fileName:    string
  success:     boolean
  fallback?:   boolean
  error?:      string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  master_documents:     'Master Documents',
  admin_orders:         'Admin Orders',
  daily_journals:       'Daily Journals',
  e_library:            'E-Library',
  classified_documents: 'Classified Documents',
  archived_files:       'Archived Files',
  admin_logs:           'Admin Logs',
  personnel_201:        '201 Files',
  organization:         'Organization Chart',
}

const MODULE_ICONS: Record<string, React.ReactNode> = {
  master_documents:     <FileText  size={14} />,
  admin_orders:         <Archive   size={14} />,
  daily_journals:       <Calendar  size={14} />,
  e_library:            <Database  size={14} />,
  classified_documents: <Shield    size={14} />,
  archived_files:       <Archive   size={14} />,
  admin_logs:           <Activity  size={14} />,
  personnel_201:        <FileText  size={14} />,
  organization:         <Database  size={14} />,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs  = Math.floor(mins / 60)
  const days = Math.floor(hrs  / 24)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs  < 24) return `${hrs}h ago`
  return `${days}d ago`
}

function summariseCronSchedule(moduleStatus: ModuleStatus[]): string {
  const enabled = moduleStatus.filter(m => m.is_enabled)
  if (enabled.length === 0) return 'No modules active'

  const hours = [...new Set(enabled.map(m => m.backup_hour ?? 2))].sort((a, b) => a - b)

  const fmt = (h: number) => {
    const display = h % 12 === 0 ? 12 : h % 12
    return `${display}:00 ${h >= 12 ? 'PM' : 'AM'}`
  }

  if (hours.length === 1) return `${fmt(hours[0])} · Vercel cron`
  return `${fmt(hours[0])}–${fmt(hours[hours.length - 1])} · Vercel cron`
}

function statusColor(status: string) {
  switch (status) {
    case 'completed': return 'text-emerald-400'
    case 'running':   return 'text-blue-400'
    case 'pending':   return 'text-amber-400'
    case 'failed':    return 'text-red-400'
    default:          return 'text-slate-400'
  }
}

function statusDot(status: string) {
  switch (status) {
    case 'completed': return 'bg-emerald-400'
    case 'running':   return 'bg-blue-400 animate-pulse'
    case 'pending':   return 'bg-amber-400'
    case 'failed':    return 'bg-red-400'
    default:          return 'bg-slate-500'
  }
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BackupRecoveryPage() {
  const { user } = useAuth()
  const router   = useRouter()

  const [health,     setHealth]     = useState<HealthData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  // Modal state
  const [triggerOpen,              setTriggerOpen]              = useState(false)
  const [recoverOpen,              setRecoverOpen]              = useState(false)
  const [scheduleOpen,             setScheduleOpen]             = useState(false)
  const [notifOpen,                setNotifOpen]                = useState(false)
  const [localStorageOpen,         setLocalStorageOpen]         = useState(false)
  const [selectedJob,              setSelectedJob]              = useState<BackupJob | null>(null)
  const [selectedModuleForRecover, setSelectedModuleForRecover] = useState<string>('')

  // Local storage state
  const [localConfig,    setLocalConfig]    = useState<LocalStorageConfig | null>(null)
  const [localSaveToasts, setLocalSaveToasts] = useState<LocalSaveToast[]>([])
  const pendingProcessed = useRef(false)

  // Guard: admin only
  useEffect(() => {
    if (user && user.role !== 'admin') router.replace('/admin')
  }, [user, router])

  // ── Load local storage config ──────────────────────────────────────────────
  useEffect(() => {
    getLocalBackupConfig().then(setLocalConfig).catch(() => {})
  }, [])

  const fetchHealth = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const res  = await fetch('/api/backup/health')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load health data')
      setHealth(json.data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchHealth() }, [fetchHealth])

  // ── Process pending local saves on page load ───────────────────────────────
  // Runs once after the first health fetch completes and local config is known.
  // This catches any cron/scheduled backups that completed while the browser
  // was closed.
  useEffect(() => {
    if (!localConfig || !health || pendingProcessed.current) return
    pendingProcessed.current = true

    processPendingLocalSaves((result) => {
      const toast: LocalSaveToast = {
        id:          result.jobId,
        module_name: result.module_name,
        fileName:    result.fileName ?? `${result.module_name}.zip`,
        success:     result.success,
        fallback:    result.usedFallback,
        error:       result.error,
      }
      setLocalSaveToasts(prev => [...prev, toast])
      // Auto-dismiss after 6 s
      setTimeout(() => {
        setLocalSaveToasts(prev => prev.filter(t => t.id !== toast.id))
      }, 6000)
    })
  }, [localConfig, health])

  // ── Save a single job to local device ─────────────────────────────────────
  const saveJobToLocal = useCallback(async (job: BackupJob) => {
    if (!job.download_url) return
    const fileName = `${job.module_name}_${job.id.slice(0, 8)}.zip`

    const result: SaveResult = await saveBackupFromUrl(job.download_url, fileName)

    if (result.success) {
      await markJobLocalSaved(job.id)
    }

    const toast: LocalSaveToast = {
      id:          job.id,
      module_name: job.module_name,
      fileName:    result.fileName ?? fileName,
      success:     result.success,
      fallback:    result.usedFallback,
      error:       result.error,
    }
    setLocalSaveToasts(prev => [...prev, toast])
    setTimeout(() => {
      setLocalSaveToasts(prev => prev.filter(t => t.id !== toast.id))
    }, 6000)
  }, [])

  // ── Called by TriggerBackupModal after a job completes ────────────────────
  const handleBackupSuccess = useCallback(async (jobId?: string) => {
    setTriggerOpen(false)
    await fetchHealth(true)

    // If local storage is configured, immediately save the just-completed job
    if (localConfig && jobId) {
      // Re-fetch the specific job to get its download_url
      try {
        const res  = await fetch('/api/backup/health')
        const json = await res.json()
        const jobs: BackupJob[] = json.data?.recentJobs ?? []
        const job = jobs.find(j => j.id === jobId)
        if (job && job.status === 'completed' && job.download_url) {
          await saveJobToLocal(job)
        }
      } catch (e) {
        console.warn('[Page] Could not auto-save completed job to local:', e)
      }
    }
  }, [fetchHealth, localConfig, saveJobToLocal])

  const handleQuickRestore = (module_name: string) => {
    setSelectedModuleForRecover(module_name)
    setRecoverOpen(true)
  }

  if (user?.role !== 'admin') return null

  const score       = health?.summary.health_score ?? 0
  const scoreColor  = score >= 90 ? '#34d399' : score >= 70 ? '#fbbf24' : '#f87171'
  const circumference = 2 * Math.PI * 40

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">

      {/* ── Header ── */}
      <div className="border-b border-slate-200 bg-white/90 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-200 flex items-center justify-center">
              <Shield size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 tracking-tight">Backup &amp; Recovery</h1>
              <p className="text-[11px] text-slate-500">Super Admin · DNPPO RMS v1.4.2</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchHealth(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg bg-white transition"
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={() => setNotifOpen(true)}
              className="relative flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg bg-white transition"
            >
              <Bell size={13} />
              Alerts
              {(health?.unreadNotifications ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold flex items-center justify-center text-white">
                  {health!.unreadNotifications}
                </span>
              )}
            </button>

            {/* Local Storage button — shows folder name or "Set up local storage" */}
            <button
              onClick={() => setLocalStorageOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg transition ${
                localConfig
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                  : 'text-slate-600 bg-white border-slate-200 hover:bg-slate-50'
              }`}
            >
              <HardDrive size={13} className={localConfig ? 'text-emerald-600' : 'text-slate-400'} />
              {localConfig ? localConfig.folderName : 'Local Storage'}
            </button>

            <button
              onClick={() => setScheduleOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition"
            >
              <Settings size={13} className="text-slate-500" />
              Schedule
            </button>
            <button
              onClick={() => setTriggerOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg font-semibold transition"
            >
              <Play size={13} />
              Run Backup
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {error && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        {/* ── Local Storage Status Banner ── */}
        {!loading && !localConfig && (
          <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="flex items-center gap-2.5 text-sm text-amber-800">
              <AlertTriangle size={15} className="text-amber-500 shrink-0" />
              <span>
                <span className="font-semibold">Local backup storage not configured.</span>
                {' '}Backups are stored in Supabase cloud only.
              </span>
            </div>
            <button
              onClick={() => setLocalStorageOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg font-semibold transition shrink-0"
            >
              <FolderOpen size={12} />
              Set Up
            </button>
          </div>
        )}

        {/* ── Health Cards ── */}
        {loading ? (
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 rounded-2xl bg-white animate-pulse border border-slate-200" />
            ))}
          </div>
        ) : health && (
          <>
            <div className="grid grid-cols-4 gap-4">

              {/* Health Score */}
              <div className="col-span-1 bg-white border border-slate-200 rounded-2xl p-5 flex flex-col items-center justify-center gap-3">
                <div className="relative w-24 h-24">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#e2e8f0" strokeWidth="8"/>
                    <circle cx="50" cy="50" r="40" fill="none" stroke={scoreColor} strokeWidth="8"
                      strokeDasharray={circumference}
                      strokeDashoffset={circumference - (score / 100) * circumference}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dashoffset 1s ease' }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold" style={{ color: scoreColor }}>{score}%</span>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-slate-900">Health Score</p>
                  <p className="text-[10px] text-slate-500">Last 30 days</p>
                </div>
              </div>

              {/* Stats */}
              <div className="col-span-3 grid grid-cols-3 gap-4">
                <StatCard
                  icon={<CheckCircle2 size={18} className="text-emerald-400" />}
                  label="Successful"
                  value={health.summary.successful_backups}
                  sub={`Last: ${formatRelative(health.summary.last_success_at)}`}
                  color="emerald"
                />
                <StatCard
                  icon={<XCircle size={18} className="text-red-400" />}
                  label="Failed"
                  value={health.summary.failed_backups}
                  sub={health.summary.last_failure_at ? `Last: ${formatRelative(health.summary.last_failure_at)}` : 'No failures'}
                  color="red"
                />
                <StatCard
                  icon={<HardDrive size={18} className="text-blue-400" />}
                  label="Total Size"
                  value={`${health.summary.total_size_gb} GB`}
                  sub={`${health.summary.total_backups} total jobs`}
                  color="blue"
                />
                <StatCard
                  icon={<Zap size={18} className="text-amber-400" />}
                  label="Recovery Ready"
                  value={health.summary.recovery_ready ? 'Yes' : 'No'}
                  sub="Backup within 25h"
                  color={health.summary.recovery_ready ? 'amber' : 'red'}
                />
                <StatCard
                  icon={<Activity size={18} className="text-purple-400" />}
                  label="Modules Active"
                  value={health.moduleStatus.filter(m => m.is_enabled).length}
                  sub={`of ${health.moduleStatus.length} configured`}
                  color="purple"
                />
                <StatCard
                  icon={<Clock size={18} className="text-sky-400" />}
                  label="Cron Schedule"
                  value={summariseCronSchedule(health.moduleStatus)}
                  sub="Per module config"
                  color="sky"
                />
              </div>
            </div>

            {/* ── Local Storage Card ── */}
            <LocalStorageStatusCard
              config={localConfig}
              onConfigure={() => setLocalStorageOpen(true)}
            />

            {/* ── Module Status Grid ── */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-slate-900 tracking-tight">Module Status</h2>
                <span className="text-[11px] text-slate-500">Click module to quick-restore</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {health.moduleStatus.map(mod => (
                  <ModuleCard
                    key={mod.module_name}
                    mod={mod}
                    recentJob={health.recentJobs.find(j => j.module_name === mod.module_name)}
                    onRestore={() => handleQuickRestore(mod.module_name)}
                    onSchedule={() => setScheduleOpen(true)}
                  />
                ))}
              </div>
            </section>

            {/* ── Recent Jobs ── */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-slate-900 tracking-tight">Recent Backup Jobs</h2>
                <span className="text-[11px] text-slate-500">Last 20 jobs</span>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left px-5 py-3 text-slate-500 font-medium">Module</th>
                      <th className="text-left px-4 py-3 text-slate-500 font-medium">Type</th>
                      <th className="text-left px-4 py-3 text-slate-500 font-medium">Status</th>
                      <th className="text-left px-4 py-3 text-slate-500 font-medium">Started</th>
                      <th className="text-left px-4 py-3 text-slate-500 font-medium">Size</th>
                      <th className="text-left px-4 py-3 text-slate-500 font-medium">Local</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {health.recentJobs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-10 text-slate-500">No backup jobs yet</td>
                      </tr>
                    ) : health.recentJobs.map(job => (
                      <tr
                        key={job.id}
                        className="border-b border-slate-100 hover:bg-slate-50 transition cursor-pointer"
                        onClick={() => setSelectedJob(job)}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400">{MODULE_ICONS[job.module_name]}</span>
                            <span className="text-slate-900 font-medium">{MODULE_LABELS[job.module_name] ?? job.module_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-400 capitalize">{job.backup_type}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${statusDot(job.status)}`} />
                            <span className={`capitalize font-medium ${statusColor(job.status)}`}>{job.status}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-400">{formatRelative(job.started_at)}</td>
                        <td className="px-4 py-3 text-slate-400">{formatBytes(job.total_size_bytes)}</td>
                        <td className="px-4 py-3">
                          {/* Download to local button — only shown for completed jobs with a URL */}
                          {job.status === 'completed' && job.download_url ? (
                            <button
                              onClick={e => { e.stopPropagation(); saveJobToLocal(job) }}
                              title="Save to local device"
                              className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg bg-white transition"
                            >
                              <Download size={11} />
                              Save
                            </button>
                          ) : (
                            <span className="text-slate-300 text-[11px]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-300">
                          <ChevronRight size={14} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>

      {/* ── Local Save Toasts ── */}
      <LocalSaveToastStack toasts={localSaveToasts} />

      {/* ── Modals ── */}
      <TriggerBackupModal
        open={triggerOpen}
        onClose={() => setTriggerOpen(false)}
        onSuccess={handleBackupSuccess}
      />
      <RecoverModal
        open={recoverOpen}
        onClose={() => { setRecoverOpen(false); setSelectedModuleForRecover('') }}
        onSuccess={() => { setRecoverOpen(false); fetchHealth(true) }}
        defaultModule={selectedModuleForRecover}
        recentJobs={health?.recentJobs ?? []}
      />
      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSaved={() => { setScheduleOpen(false); fetchHealth(true) }}
        moduleStatus={health?.moduleStatus ?? []}
      />
      <NotificationsModal
        open={notifOpen}
        onClose={() => { setNotifOpen(false); fetchHealth(true) }}
      />
      <LocalStorageSetupModal
        open={localStorageOpen}
        onClose={() => setLocalStorageOpen(false)}
        onChange={setLocalConfig}
      />
      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onRecover={() => {
            const moduleName = selectedJob.module_name
            setSelectedJob(null)
            setSelectedModuleForRecover(moduleName)
            setRecoverOpen(true)
          }}
        />
      )}
    </div>
  )
}

// ── LocalStorageStatusCard ────────────────────────────────────────────────────

function LocalStorageStatusCard({
  config,
  onConfigure,
}: {
  config:      LocalStorageConfig | null
  onConfigure: () => void
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
            config ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-100 border border-slate-200'
          }`}>
            <HardDrive size={16} className={config ? 'text-emerald-600' : 'text-slate-400'} />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-900">Local Device Storage</p>
            {config ? (
              <p className="text-[11px] text-slate-500">
                Saving to <span className="font-medium text-slate-700">{config.folderName}</span>
                {config.lastTestedAt && (
                  <> · Last tested {formatRelative(config.lastTestedAt)}</>
                )}
                {!config.fsa_supported && (
                  <span className="ml-1 text-amber-600">(browser download mode)</span>
                )}
              </p>
            ) : (
              <p className="text-[11px] text-slate-400">Not configured — backups saved to cloud only</p>
            )}
          </div>
        </div>
        <button
          onClick={onConfigure}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 bg-white hover:bg-slate-50 rounded-lg transition"
        >
          <FolderOpen size={12} />
          {config ? 'Change' : 'Configure'}
        </button>
      </div>

      {config && (
        <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 gap-3 text-[11px]">
          <div>
            <p className="text-slate-400">Folder</p>
            <p className="font-medium text-slate-700 truncate">{config.folderName}</p>
          </div>
          <div>
            <p className="text-slate-400">Mode</p>
            <p className="font-medium text-slate-700">
              {config.fsa_supported ? 'Direct write (FSA)' : 'Browser download'}
            </p>
          </div>
          <div>
            <p className="text-slate-400">Status</p>
            <p className={`font-medium ${config.isValidated ? 'text-emerald-600' : 'text-amber-600'}`}>
              {config.isValidated ? 'Verified writable' : 'Not yet verified'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── LocalSaveToastStack ───────────────────────────────────────────────────────

function LocalSaveToastStack({ toasts }: { toasts: LocalSaveToast[] }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-start gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-xs max-w-xs animate-in slide-in-from-right-4 duration-300 ${
            t.success
              ? 'bg-white border-emerald-200 text-slate-800'
              : 'bg-white border-red-200 text-slate-800'
          }`}
        >
          {t.success
            ? <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
            : <XCircle     size={14} className="text-red-500 mt-0.5 shrink-0" />
          }
          <div>
            <p className="font-semibold">
              {t.success ? 'Saved to device' : 'Local save failed'}
            </p>
            <p className="text-slate-500 text-[11px] truncate max-w-[200px]">
              {t.success
                ? (t.fallback ? `Downloaded: ${t.fileName}` : t.fileName)
                : t.error
              }
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string | number; sub: string; color: string
}) {
  const bg: Record<string, string> = {
    emerald: 'bg-emerald-50 border-emerald-200',
    red:     'bg-red-50 border-red-200',
    blue:    'bg-blue-50 border-blue-200',
    amber:   'bg-amber-50 border-amber-200',
    purple:  'bg-purple-50 border-purple-200',
    sky:     'bg-sky-50 border-sky-200',
  }
  return (
    <div className={`rounded-xl border p-4 ${bg[color] ?? 'bg-white border-slate-200'}`}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-[11px] text-slate-500 font-medium">{label}</span></div>
      <p className="text-xl font-bold text-slate-900 truncate">{value}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>
    </div>
  )
}

function ModuleCard({ mod, recentJob, onRestore, onSchedule }: {
  mod:        ModuleStatus
  recentJob?: BackupJob
  onRestore:  () => void
  onSchedule: () => void
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 group hover:border-slate-300 transition">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">{MODULE_ICONS[mod.module_name]}</span>
          <span className="text-sm font-semibold text-slate-900">{MODULE_LABELS[mod.module_name] ?? mod.module_name}</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
          mod.is_enabled
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-slate-100 text-slate-500'
        }`}>
          {mod.is_enabled ? 'Active' : 'Disabled'}
        </span>
      </div>

      <div className="space-y-1 mb-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">Frequency</span>
          <span className="text-slate-700 capitalize">{mod.frequency}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">Last job</span>
          <span className={`capitalize font-medium ${recentJob ? statusColor(recentJob.status) : 'text-slate-500'}`}>
            {recentJob ? `${recentJob.status} · ${formatRelative(recentJob.started_at)}` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500">Size</span>
          <span className="text-slate-700">{formatBytes(recentJob?.total_size_bytes ?? null)}</span>
        </div>
      </div>

      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition">
        <button
          onClick={onRestore}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] text-slate-700 bg-white hover:bg-slate-50 rounded-lg border border-slate-200 transition font-medium"
        >
          <RotateCcw size={11} /> Restore
        </button>
        <button
          onClick={onSchedule}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] text-slate-700 bg-white hover:bg-slate-50 rounded-lg border border-slate-200 transition"
        >
          <Settings size={11} /> Config
        </button>
      </div>
    </div>
  )
}