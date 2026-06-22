'use client'
import { useState } from 'react'
import { createAccount } from './actions'

interface Props {
  onClose:   () => void
  onSuccess: (role: string) => void
}

const COLOR_OPTIONS = [
  '#16a34a', '#2563eb', '#dc2626', '#d97706',
  '#7c3aed', '#0891b2', '#be185d', '#374151',
]

export function CreateAccountModal({ onClose, onSuccess }: Props) {
  const [form, setForm] = useState({
    email:         '',
    password:      '',
    role:          '',
    display_name:  '',
    title:         '',
    initials:      '',
    avatar_color:  '#2563eb',
    nav_group:     'documents' as 'documents' | 'admin' | 'dpda-dpdo',
    can_upload:    true,
    is_viewer_only: true,
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const set = (key: keyof typeof form, value: unknown) =>
    setForm(prev => ({ ...prev, [key]: value }))

  async function handleSubmit() {
    setError('')
    if (!form.email || !form.password || !form.role || !form.display_name) {
      setError('Please fill in all required fields.')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (!/^[A-Z0-9_]+$/.test(form.role.toUpperCase())) {
      setError('Role ID must be letters, numbers, or underscores only (e.g. P11, FINANCE).')
      return
    }

    setLoading(true)
    try {
      await createAccount({ ...form, role: form.role.toUpperCase() })
      onSuccess(form.role.toUpperCase())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create account.')
    } finally {
      setLoading(false)
    }
  }

  const labelCls = 'block text-xs font-semibold text-slate-700 mb-1'
  const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">➕ Create New Account</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              ❌ {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>Email Address *</label>
              <input type="email" value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="officer@dnppo.gov.ph" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Role ID * <span className="text-slate-400 font-normal">(e.g. P11, FINANCE)</span></label>
              <input type="text" value={form.role}
                onChange={e => set('role', e.target.value.toUpperCase())}
                placeholder="P11" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Password *</label>
              <input type="password" value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder="Min. 8 characters" className={inputCls} />
            </div>

            <div className="col-span-2">
              <label className={labelCls}>Display Name * <span className="text-slate-400 font-normal">(shown in sidebar)</span></label>
              <input type="text" value={form.display_name}
                onChange={e => set('display_name', e.target.value)}
                placeholder="Admin Officer — Finance" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Title</label>
              <input type="text" value={form.title}
                onChange={e => set('title', e.target.value)}
                placeholder="Finance Officer" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Initials <span className="text-slate-400 font-normal">(2 letters)</span></label>
              <input type="text" maxLength={3} value={form.initials}
                onChange={e => set('initials', e.target.value.toUpperCase())}
                placeholder="FN" className={inputCls} />
            </div>
          </div>

          {/* Avatar Color */}
          <div>
            <label className={labelCls}>Avatar Color</label>
            <div className="flex gap-2 flex-wrap mt-1">
              {COLOR_OPTIONS.map(color => (
                <button key={color} onClick={() => set('avatar_color', color)}
                  className={`w-8 h-8 rounded-full border-2 transition ${
                    form.avatar_color === color ? 'border-slate-800 scale-110' : 'border-transparent'
                  }`}
                  style={{ background: color }} />
              ))}
            </div>
          </div>

          {/* Nav Group */}
          <div>
            <label className={labelCls}>Navigation Group</label>
            <select value={form.nav_group}
              onChange={e => set('nav_group', e.target.value as 'documents' | 'admin' | 'dpda-dpdo')}
              className={inputCls}>
              <option value="documents">Documents (P1–P10, etc.)</option>
              <option value="dpda-dpdo">DPDA/DPDO</option>
              <option value="admin">Admin-only (log history, user management, etc.)</option>
            </select>
            <p className="text-[10px] text-slate-400 mt-1">
              Controls which sidebar menu items the account sees.
            </p>
          </div>

          {/* Permissions */}
          <div className="space-y-2">
            <label className={labelCls}>Permissions</label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.can_upload}
                onChange={e => set('can_upload', e.target.checked)}
                className="w-4 h-4 rounded" />
              Can upload documents
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.is_viewer_only}
                onChange={e => set('is_viewer_only', e.target.checked)}
                className="w-4 h-4 rounded" />
              Viewer-only nav (no 201 Personnel Files tab)
            </label>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 flex items-center gap-2">
            {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Creating…' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>
  )
}