'use client'

import { useState, useEffect } from 'react'
import { Settings, X, Save, AlertTriangle, CheckCircle2, ChevronDown } from 'lucide-react'

const MODULES = [
  { key: 'master_documents',    label: 'Master Documents'    },
  { key: 'admin_orders',        label: 'Admin Orders'        },
  { key: 'daily_journals',      label: 'Daily Journals'      },
  { key: 'e_library',           label: 'E-Library'           },
  { key: 'classified_documents',label: 'Classified Documents'},
  { key: 'archived_files',      label: 'Archived Files'      },
  { key: 'admin_logs',          label: 'Admin Logs'          },
  { key: 'personnel_201',       label: '201 Files'           },
  { key: 'organization',        label: 'Organization Chart'  },
]

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly', 'custom'] as const
const BACKUP_TYPES = ['full', 'incremental', 'differential'] as const

interface ModuleStatus {
  module_name:        string
  is_enabled:         boolean
  frequency:          string
  last_configured_at: string | null
}

interface ScheduleForm {
  module_name:         string
  is_enabled:          boolean
  frequency:           typeof FREQUENCIES[number]
  custom_cron:         string
  backup_type:         typeof BACKUP_TYPES[number]
  include_attachments: boolean
  encrypt_backup:      boolean
  retention_days:      number
}

const DEFAULT_FORM: ScheduleForm = {
  module_name:         '',
  is_enabled:          true,
  frequency:           'daily',
  custom_cron:         '0 2 * * *',
  backup_type:         'full',
  include_attachments: true,
  encrypt_backup:      true,
  retention_days:      90,
}

interface Props {
  open:         boolean
  onClose:      () => void
  onSaved:      () => void
  moduleStatus: ModuleStatus[]
}

export function ScheduleModal({ open, onClose, onSaved, moduleStatus }: Props) {
  const [form,    setForm]    = useState<ScheduleForm>(DEFAULT_FORM)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [saved,   setSaved]   = useState(false)

  // When a module is selected, pre-fill from existing config
  useEffect(() => {
    if (!form.module_name) return
    const existing = moduleStatus.find(m => m.module_name === form.module_name)
    if (existing) {
      setForm(f => ({
        ...f,
        is_enabled: existing.is_enabled,
        frequency:  (existing.frequency as typeof FREQUENCIES[number]) || 'daily',
      }))
    }
  }, [form.module_name]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const set = <K extends keyof ScheduleForm>(k: K, v: ScheduleForm[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!form.module_name) { setError('Select a module.'); return }
    setError(null); setLoading(true)
    try {
      const res  = await fetch('/api/backup/schedule', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to save')
      setSaved(true)
      setTimeout(() => { setSaved(false); onSaved() }, 1500)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setForm(DEFAULT_FORM); setError(null); setSaved(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-[#131c2e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#1b365d] flex items-center justify-center">
              <Settings size={15} className="text-[#fde047]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Configure Backup Schedule</h2>
              <p className="text-[11px] text-slate-400">Changes apply to the next scheduled run</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-slate-500 hover:text-white transition"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[75vh] overflow-y-auto">

          {saved ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <CheckCircle2 size={24} className="text-emerald-400" />
              </div>
              <p className="text-sm font-semibold text-white">Schedule Saved</p>
            </div>
          ) : (
            <>
              {/* Module */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Module</label>
                <div className="relative">
                  <select
                    value={form.module_name}
                    onChange={e => set('module_name', e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white appearance-none focus:outline-none focus:border-[#fde047]/40 transition"
                  >
                    <option value="" disabled className="bg-[#131c2e]">Select module…</option>
                    {MODULES.map(m => (
                      <option key={m.key} value={m.key} className="bg-[#131c2e]">{m.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>

              {/* Enable Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-300">Enable Automated Backup</p>
                  <p className="text-[11px] text-slate-500">Module will run on the selected frequency</p>
                </div>
                <button
                  onClick={() => set('is_enabled', !form.is_enabled)}
                  className={`w-11 h-6 rounded-full transition relative ${form.is_enabled ? 'bg-[#fde047]' : 'bg-white/15'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${form.is_enabled ? 'left-5.5 left-[calc(100%-1.375rem)]' : 'left-0.5'}`} />
                </button>
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Frequency</label>
                <div className="flex gap-2">
                  {FREQUENCIES.map(f => (
                    <button key={f}
                      onClick={() => set('frequency', f)}
                      className={`flex-1 py-2 text-[11px] capitalize rounded-lg border transition font-medium ${
                        form.frequency === f
                          ? 'bg-[#1b365d] border-[#fde047]/30 text-white'
                          : 'bg-white/3 border-white/8 text-slate-400 hover:border-white/20 hover:text-white'
                      }`}
                    >{f}</button>
                  ))}
                </div>
                {form.frequency === 'custom' && (
                  <div className="mt-2">
                    <input
                      type="text"
                      value={form.custom_cron}
                      onChange={e => set('custom_cron', e.target.value)}
                      placeholder="0 2 * * *"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white font-mono focus:outline-none focus:border-[#fde047]/40 transition"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Cron expression (UTC). Default: <code className="text-slate-400">0 2 * * *</code> = daily at 2 AM
                    </p>
                  </div>
                )}
              </div>

              {/* Backup Type */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">Backup Type</label>
                <div className="flex gap-2">
                  {BACKUP_TYPES.map(t => (
                    <button key={t}
                      onClick={() => set('backup_type', t)}
                      className={`flex-1 py-2 text-[11px] capitalize rounded-lg border transition font-medium ${
                        form.backup_type === t
                          ? 'bg-[#1b365d] border-[#fde047]/30 text-white'
                          : 'bg-white/3 border-white/8 text-slate-400 hover:border-white/20 hover:text-white'
                      }`}
                    >{t}</button>
                  ))}
                </div>
              </div>

              {/* Options */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-300">Options</p>
                <Toggle
                  label="Include File Attachments"
                  sub="Downloads files from Google Drive pool"
                  value={form.include_attachments}
                  onChange={v => set('include_attachments', v)}
                />
                <Toggle
                  label="Encrypt Backup"
                  sub="AES-256-GCM via BACKUP_ENCRYPTION_SECRET"
                  value={form.encrypt_backup}
                  onChange={v => set('encrypt_backup', v)}
                />
              </div>

              {/* Retention */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Retention Period — <span className="text-[#fde047]">{form.retention_days} days</span>
                </label>
                <input
                  type="range" min={7} max={365} step={1}
                  value={form.retention_days}
                  onChange={e => set('retention_days', Number(e.target.value))}
                  className="w-full accent-[#fde047]"
                />
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>7 days</span><span>1 year</span>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-[11px] text-red-400">
                  <AlertTriangle size={13} /> {error}
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={loading || !form.module_name}
                className="w-full py-2.5 text-sm font-semibold text-[#0f1623] bg-[#fde047] hover:bg-[#fde047]/90 disabled:opacity-50 rounded-xl transition flex items-center justify-center gap-2"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-[#0f1623]/30 border-t-[#0f1623] rounded-full animate-spin" />
                ) : (
                  <><Save size={14} /> Save Schedule</>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Toggle({ label, sub, value, onChange }: {
  label: string; sub: string; value: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-[12px] text-slate-200">{label}</p>
        <p className="text-[11px] text-slate-500">{sub}</p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`w-10 h-5 rounded-full transition relative shrink-0 ${value ? 'bg-[#fde047]' : 'bg-white/15'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${value ? 'left-[calc(100%-1.125rem)]' : 'left-0.5'}`} />
      </button>
    </div>
  )
}