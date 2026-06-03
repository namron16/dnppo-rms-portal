'use client'

import { useState } from 'react'

interface Props {
  userId:      string
  displayName: string
  onClose:     () => void
  onSuccess:   () => void
}

export function ResetPasswordModal({ userId, displayName, onClose, onSuccess }: Props) {
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [showPw,   setShowPw]   = useState(false)
  const [showCf,   setShowCf]   = useState(false)

  async function handleSubmit() {
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { adminResetPassword } = await import('./actions')
      await adminResetPassword(userId, password)
      onSuccess()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Reset failed.')
    } finally {
      setLoading(false)
    }
  }

  const len   = password.length >= 8
  const match = password.length > 0 && confirm.length > 0 && password === confirm
  const canSubmit = !loading && len && match

  const strength = password.length === 0
    ? 0
    : password.length < 8
    ? 1
    : password.length < 12
    ? 2
    : 3

  const strengthLabel = ['', 'Weak', 'Good', 'Strong']
  const strengthColor = ['', '#ef4444', '#f59e0b', '#10b981']

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
        <div style={{ height: 4, background: 'linear-gradient(90deg, #f59e0b, #d97706)' }} />

        <div className="p-7 space-y-5">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center rounded-xl"
                style={{ width: 44, height: 44, background: '#fffbeb', border: '1.5px solid #fde68a' }}
              >
                {/* Key icon */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7.5" cy="15.5" r="5.5"/>
                  <path d="M21 2l-9.6 9.6"/>
                  <path d="M15.5 7.5l3 3L22 7l-3-3"/>
                </svg>
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-slate-800 leading-tight">Reset Password</h2>
                <p className="text-[12px] text-slate-400 mt-0.5">
                  Account: <span className="font-semibold text-amber-600">{displayName}</span>
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

          {/* New Password */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              New Password
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter new password"
                className="w-full rounded-xl text-sm px-3.5 py-2.5 pr-10 transition-all"
                style={{
                  border: '1.5px solid',
                  borderColor: password.length > 0 && !len ? '#fca5a5' : '#e2e8f0',
                  outline: 'none',
                  background: '#f8fafc',
                  color: '#1e293b',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#f59e0b'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.12)' }}
                onBlur={e  => { e.currentTarget.style.borderColor = password.length > 0 && !len ? '#fca5a5' : '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.boxShadow = 'none' }}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 transition"
                style={{ color: '#94a3b8' }}
              >
                {showPw
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>

            {/* Strength bar */}
            {password.length > 0 && (
              <div className="space-y-1">
                <div className="flex gap-1">
                  {[1, 2, 3].map(i => (
                    <div
                      key={i}
                      className="h-1 flex-1 rounded-full transition-all duration-300"
                      style={{ background: strength >= i ? strengthColor[strength] : '#e2e8f0' }}
                    />
                  ))}
                </div>
                <p className="text-[11px] font-semibold" style={{ color: strengthColor[strength] }}>
                  {strengthLabel[strength]}
                  {!len && <span className="text-slate-400 font-normal"> · minimum 8 characters</span>}
                </p>
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M9 12l2 2 4-4"/>
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Confirm Password
            </label>
            <div className="relative">
              <input
                type={showCf ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Re-enter password"
                className="w-full rounded-xl text-sm px-3.5 py-2.5 pr-10 transition-all"
                style={{
                  border: '1.5px solid',
                  borderColor: confirm.length > 0 && password !== confirm ? '#fca5a5' : confirm.length > 0 && match ? '#86efac' : '#e2e8f0',
                  outline: 'none',
                  background: '#f8fafc',
                  color: '#1e293b',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#f59e0b'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.12)' }}
                onBlur={e  => { e.currentTarget.style.borderColor = confirm.length > 0 && password !== confirm ? '#fca5a5' : confirm.length > 0 && match ? '#86efac' : '#e2e8f0'; e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.boxShadow = 'none' }}
              />
              <button
                type="button"
                onClick={() => setShowCf(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 transition"
                style={{ color: '#94a3b8' }}
              >
                {showCf
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
            {confirm.length > 0 && (
              <p className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: match ? '#10b981' : '#ef4444' }}>
                {match
                  ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg> Passwords match</>
                  : <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg> Passwords do not match</>
                }
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
            style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" className="mt-px flex-shrink-0">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p className="text-[11px]" style={{ color: '#92400e' }}>
              The user's active sessions will be terminated immediately after the password is reset.
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
                background: canSubmit ? 'linear-gradient(135deg, #f59e0b, #d97706)' : '#fde68a',
                color: canSubmit ? '#fff' : '#92400e',
                border: 'none',
                boxShadow: canSubmit ? '0 4px 12px rgba(217,119,6,0.3)' : 'none',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                opacity: canSubmit ? 1 : 0.7,
              }}
            >
              {loading
                ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg> Resetting…</>
                : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg> Reset Password</>
              }
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}