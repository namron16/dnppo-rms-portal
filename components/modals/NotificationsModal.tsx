'use client'

import { useState, useEffect } from 'react'
import {
  Bell, X, CheckCircle2, XCircle, AlertTriangle,
  Info, RotateCcw, ChevronRight, Database, FileText,
  Clock, HardDrive, Shield,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Notification {
  id:            string
  backup_job_id: string | null
  type:          'success' | 'failure' | 'warning' | 'recovery'
  title:         string
  message:       string
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const [notifs,   setNotifs]   = useState<Notification[]>([])
  const [loading,  setLoading]  = useState(false)
  const [marking,  setMarking]  = useState(false)

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

  const notifIcon = (type: string) => {
    switch (type) {
      case 'success':  return <CheckCircle2 size={14} className="text-emerald-400" />
      case 'failure':  return <XCircle      size={14} className="text-red-400" />
      case 'warning':  return <AlertTriangle size={14} className="text-amber-400" />
      case 'recovery': return <RotateCcw    size={14} className="text-blue-400" />
      default:         return <Info         size={14} className="text-slate-400" />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#131c2e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/8 flex items-center justify-center">
              <Bell size={15} className="text-slate-300" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Backup Alerts</h2>
              <p className="text-[11px] text-slate-400">{unread.length} unread</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unread.length > 0 && (
              <button
                onClick={markAllRead}
                disabled={marking}
                className="text-[11px] text-[#fde047] hover:text-[#fde047]/80 transition"
              >
                Mark all read
              </button>
            )}
            <button onClick={onClose} className="text-slate-500 hover:text-white transition">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto divide-y divide-white/5">
          {loading ? (
            <div className="py-12 flex items-center justify-center">
              <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
          ) : notifs.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">No alerts yet</div>
          ) : notifs.map(n => (
            <div key={n.id} className={`px-6 py-4 transition ${!n.is_read ? 'bg-white/3' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{notifIcon(n.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-[12px] font-semibold ${!n.is_read ? 'text-white' : 'text-slate-300'}`}>
                      {n.title}
                    </p>
                    {!n.is_read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#fde047] shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">{n.message}</p>
                  <p className="text-[10px] text-slate-600 mt-1">{fmtRelative(n.created_at)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-white/8">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition"
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
  const statusColor: Record<string, string> = {
    completed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    running:   'text-blue-400 bg-blue-500/10 border-blue-500/20',
    pending:   'text-amber-400 bg-amber-500/10 border-amber-500/20',
    failed:    'text-red-400 bg-red-500/10 border-red-500/20',
    cancelled: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
  }

  const duration = (() => {
    if (!job.started_at || !job.completed_at) return '—'
    const secs = Math.round((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000)
    if (secs < 60) return `${secs}s`
    return `${Math.floor(secs / 60)}m ${secs % 60}s`
  })()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#131c2e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/8 flex items-center justify-center">
              <Database size={15} className="text-slate-300" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Backup Job Detail</h2>
              <p className="text-[11px] text-slate-400 font-mono">{job.id.slice(0, 16)}…</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Status Badge */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Status</span>
            <span className={`text-[11px] px-3 py-1 rounded-full border font-semibold capitalize ${statusColor[job.status] ?? ''}`}>
              {job.status}
            </span>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-3">
            <DetailRow icon={<FileText size={12} />}  label="Module"  value={MODULE_LABELS[job.module_name] ?? job.module_name} />
            <DetailRow icon={<Shield   size={12} />}  label="Type"    value={job.backup_type} />
            <DetailRow icon={<Clock    size={12} />}  label="Started" value={fmt(job.started_at)} />
            <DetailRow icon={<Clock    size={12} />}  label="Ended"   value={fmt(job.completed_at)} />
            <DetailRow icon={<Clock    size={12} />}  label="Duration" value={duration} />
            <DetailRow icon={<HardDrive size={12} />} label="Size"    value={formatBytes(job.total_size_bytes)} />
          </div>

          {/* Error */}
          {job.error_message && (
            <div className="flex items-start gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-red-300 font-mono break-all">{job.error_message}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 text-sm text-slate-300 bg-white/5 hover:bg-white/10 rounded-xl transition"
            >
              Close
            </button>
            {job.status === 'completed' && (
              <button
                onClick={onRecover}
                className="flex-1 py-2.5 text-sm font-semibold text-[#0f1623] bg-[#fde047] hover:bg-[#fde047]/90 rounded-xl transition flex items-center justify-center gap-2"
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
    <div className="bg-white/4 rounded-xl px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-slate-500 mb-1">
        {icon}
        <span className="text-[10px] font-medium">{label}</span>
      </div>
      <p className="text-[12px] text-white font-medium capitalize truncate">{value}</p>
    </div>
  )
}