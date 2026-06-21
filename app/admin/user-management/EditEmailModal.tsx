'use client'

import { useState } from 'react'

interface Props {
  userId:        string
  displayName:   string
  currentEmail?: string
  onClose:       () => void
  onSuccess:     (newEmail: string) => void
  onError?: (msg: string) => void
}

export function EditEmailModal({ userId, displayName, currentEmail, onClose, onSuccess, onError }: Props) {
  const [email,   setEmail]   = useState(currentEmail ?? '')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const isValidEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)
  const changed   = email !== (currentEmail ?? '')
  const valid     = isValidEmail(email)
  const canSubmit = !loading && valid && changed

  async function handleSubmit() {
    setLoading(true)
    setError(null)
    try {
      const { adminUpdateEmail } = await import('./actions')
      await adminUpdateEmail(userId, email)
      onSuccess(email)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to update email.'
      setError(msg)
      onError?.(msg)   // fires toast in parent
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl overflow-hidden"
        style={{
          background: '#fff',
          boxShadow: '0 24px 64px -12px rgba(15,23,42,0.28), 0 0 0 1px rgba(15,23,42,0.06)',
        }}
      >
        {/* Top accent bar */}
        <div style={{ height: 4, background: 'linear-gradient(90deg, #3b82f6, #2563eb)' }} />

        <div className="p-7 space-y-5">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center rounded-xl"
                style={{ width: 44, height: 44, background: '#eff6ff', border: '1.5px solid #bfdbfe' }}
              >
                {/* Mail icon */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="M22 7l-10 7L2 7"/>
                </svg>
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-slate-800 leading-tight">Edit Email Address</h2>
                <p className="text-[12px] text-slate-400 mt-0.5">
                  Account: <span className="font-semibold text-blue-600">{displayName}</span>
                </p>
              </div>
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded-lg transition hover:bg-slate-100"
              style={{ width: 32, height: 32, color: '#94a3b8' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: '#f1f5f9' }} />

          {/* Current email (read-only display) */}
          {currentEmail && (
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                Current Email
              </label>
              <div
                className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm"
                style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#94a3b8' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="M22 7l-10 7L2 7"/>
                </svg>
                <span className="font-mono tracking-tight">{currentEmail}</span>
              </div>
            </div>
          )}

          {/* New Email Input */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              New Email Address
            </label>
            <div className="relative">
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#94a3b8' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="M22 7l-10 7L2 7"/>
                </svg>
              </div>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="user@ddnppo.gov.ph"
                className="w-full rounded-xl text-sm pl-10 pr-10 py-2.5 transition-all"
                style={{
                  border: '1.5px solid',
                  borderColor: email.length > 0 && !valid ? '#fca5a5' : email.length > 0 && valid ? '#86efac' : '#e2e8f0',
                  outline: 'none',
                  background: '#f8fafc',
                  color: '#1e293b',
                  fontFamily: 'monospace',
                  letterSpacing: '-0.01em',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.12)' }}
                onBlur={e  => { e.currentTarget.style.borderColor = email.length > 0 && !valid ? '#fca5a5' : email.length > 0 && valid ? '#86efac' : '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.boxShadow = 'none' }}
              />
              {email.length > 0 && (
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  {valid
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  }
                </div>
              )}
            </div>
            {email.length > 0 && !valid && (
              <p className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: '#ef4444' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                Enter a valid email address
              </p>
            )}
            {email.length > 0 && valid && !changed && (
              <p className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: '#94a3b8' }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                No change from current email
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm"
              style={{ background: '#fff1f2', border: '1.5px solid #fecdd3', color: '#be123c' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-px flex-shrink-0">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Info note */}
          <div className="flex items-start gap-2 rounded-xl px-3.5 py-2.5"
            style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" className="mt-px flex-shrink-0">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p className="text-[11px]" style={{ color: '#1e40af' }}>
              The email is updated immediately. A confirmation email may be sent depending on your Supabase Auth settings.
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2.5 pt-1">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl transition"
              style={{ border: '1.5px solid #e2e8f0', color: '#64748b', background: '#fff' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex items-center gap-1.5 text-sm font-semibold px-5 py-2 rounded-xl transition"
              style={{
                background: canSubmit ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : '#bfdbfe',
                color: canSubmit ? '#fff' : '#1e40af',
                border: 'none',
                boxShadow: canSubmit ? '0 4px 12px rgba(37,99,235,0.3)' : 'none',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                opacity: canSubmit ? 1 : 0.7,
              }}
            >
              {loading
                ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg> Saving…</>
                : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg> Save Email</>
              }
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}