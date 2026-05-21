'use client'

import { useState, useEffect } from 'react'
import {
  Bell, X, CheckCircle2, XCircle, AlertTriangle,
  Info, RotateCcw, Database, FileText,
  Clock, HardDrive, Shield,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Notification {
  id:            string
  job_id:        string | null   // FIX: was backup_job_id — matches notifications.ts insert
  // FIX: added 'error' to union — notifications.ts inserts type:'error' for failures,
  // not 'failure'. Kept 'failure' for backwards compat with any older rows.
  type:          'success' | 'error' | 'failure' | 'warning' | 'recovery'
  title:         string
  body:          string          // FIX: was 'message' — notifications.ts inserts { body }
  is_read:       boolean
  created_at:    string
}

interface BackupJob {
  id:               string
  module_name:      string
  status:           string
  backup_type:      string
  frequency:        string
  started_at:       string | null
  completed_at:     string | null
  total_size_bytes: number | null
  error_message:    string | null
  // FIX: added download_url — engine.ts now stores this after every successful backup
  download_url:     string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function formatBytes(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hrs  = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24)  return `${hrs}h ago`
  return `${days}d ago`
}

// ══════════════════════════════════════════════════════════════════════════════
// NotificationsModal
// ══════════════════════════════════════════════════════════════════════════════

interface NotifProps {
  open:    boolean
  onClose: () => void
}

export function NotificationsModal({ open, onClose }: NotifProps) {
  const [notifs,  setNotifs]  = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [marking, setMarking] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch('/api/backup/notifications')
      .then(r => r.json())
      .then(j => setNotifs(j.data ?? []))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const unread = notifs.filter(n => !n.is_read)

  const markAllRead = async () => {
    if (unread.length === 0) return
    setMarking(true)
    await fetch('/api/backup/notifications', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ids: unread.map(n => n.id) }),
    })
    setNotifs(prev => prev.map(n => ({ ...n, is_read: true })))
    setMarking(false)
  }

  // FIX: added 'error' case to match what notifications.ts actually inserts.
  // 'failure' kept as alias for backwards compatibility with older rows.
  const notifIcon = (type: string) => {
    switch (type) {
      case 'success':          return <CheckCircle2  size={14} className="text-emerald-400" />
      case 'error':
      case 'failure':          return <XCircle       size={14} className="text-red-400" />
      case 'warning':          return <AlertTriangle size={14} className="text-amber-400" />
      case 'recovery':         return <RotateCcw     size={14} className="text-blue-400" />
      default:                 return <Info          size={14} className="text-slate-400" />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
              <Bell size={15} className="text-slate-700" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Backup Alerts</h2>
              <p className="text-[11px] text-slate-500">{unread.length} unread</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unread.length > 0 && (
              <button
                onClick={markAllRead}
                disabled={marking}
                className="text-[11px] text-amber-600 hover:text-amber-700 transition"
              >
                Mark all read
              </button>
            )}
            <button onClick={onClose} className="text-slate-500 hover:text-slate-900 transition">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100">
          {loading ? (
            <div className="py-12 flex items-center justify-center">
              <span className="w-5 h-5 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" />
            </div>
          ) : notifs.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">No alerts yet</div>
          ) : notifs.map(n => (
            <div key={n.id} className={`px-6 py-4 transition ${!n.is_read ? 'bg-slate-50' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{notifIcon(n.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-[12px] font-semibold truncate ${!n.is_read ? 'text-slate-900' : 'text-slate-700'}`}>
                      {n.title}
                    </p>
                    {!n.is_read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    )}
                  </div>
                  {/* FIX: was n.message — now reads n.body to match the DB column */}
                  <p className="text-[11px] text-slate-500 mt-0.5">{n.body}</p>
                  <p className="text-[10px] text-slate-400 mt-1">{fmtRelative(n.created_at)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// JobDetailModal
// ══════════════════════════════════════════════════════════════════════════════

interface JobDetailProps {
  job:       BackupJob
  onClose:   () => void
  onRecover: () => void
}

export function JobDetailModal({ job, onClose, onRecover }: JobDetailProps) {
  const statusStyle: Record<string, string> = {
    completed: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    running:   'text-blue-600 bg-blue-50 border-blue-200',
    pending:   'text-amber-600 bg-amber-50 border-amber-200',
    failed:    'text-red-600 bg-red-50 border-red-200',
    cancelled: 'text-slate-500 bg-slate-100 border-slate-200',
  }

  const duration = (() => {
    if (!job.started_at || !job.completed_at) return '—'
    const secs = Math.round(
      (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000
    )
    if (secs < 60) return `${secs}s`
    return `${Math.floor(secs / 60)}m ${secs % 60}s`
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
              <Database size={15} className="text-slate-700" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Backup Job Detail</h2>
              <p className="text-[11px] text-slate-500 font-mono">{job.id.slice(0, 16)}…</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 transition">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Status Badge */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Status</span>
            <span className={`text-[11px] px-3 py-1 rounded-full border font-semibold capitalize ${statusStyle[job.status] ?? ''}`}>
              {job.status}
            </span>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-3">
            <DetailRow icon={<FileText  size={12} />} label="Module"   value={MODULE_LABELS[job.module_name] ?? job.module_name} />
            <DetailRow icon={<Shield    size={12} />} label="Type"     value={job.backup_type} />
            <DetailRow icon={<Clock     size={12} />} label="Started"  value={fmt(job.started_at)} />
            <DetailRow icon={<Clock     size={12} />} label="Ended"    value={fmt(job.completed_at)} />
            <DetailRow icon={<Clock     size={12} />} label="Duration" value={duration} />
            <DetailRow icon={<HardDrive size={12} />} label="Size"     value={formatBytes(job.total_size_bytes)} />
          </div>

          {/* Download link — only shown when backup completed and URL is available */}
          {job.status === 'completed' && job.download_url && (
            <a
              href={job.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2 text-[12px] font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition"
            >
              <HardDrive size={13} /> Download Backup ZIP
            </a>
          )}

          {/* Error */}
          {job.error_message && (
            <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl">
              <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
              <p className="text-[11px] text-red-700 font-mono break-all">{job.error_message}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 text-sm text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition"
            >
              Close
            </button>
            {job.status === 'completed' && (
              <button
                onClick={onRecover}
                className="flex-1 py-2.5 text-sm font-semibold text-slate-900 bg-amber-400 hover:bg-amber-300 rounded-xl transition flex items-center justify-center gap-2"
              >
                <RotateCcw size={14} /> Restore
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-slate-400 mb-1">
        {icon}
        <span className="text-[10px] font-medium">{label}</span>
      </div>
      <p className="text-[12px] text-slate-900 font-medium capitalize truncate">{value}</p>
    </div>
  )
}