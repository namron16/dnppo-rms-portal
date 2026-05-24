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

  const strong = password.length >= 12

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800">
          Reset Password — <span className="text-amber-600">{displayName}</span>
        </h2>

        {(['New Password', 'Confirm Password'] as const).map((label, i) => (
          <div key={label} className="space-y-1">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {label}
            </label>
            <input
              type="password"
              value={i === 0 ? password : confirm}
              onChange={e => i === 0 ? setPassword(e.target.value) : setConfirm(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
        ))}

        {password && (
          <p className={`text-[11px] font-semibold ${strong ? 'text-emerald-600' : 'text-red-500'}`}>
            {strong ? '✓ Minimum length met' : '✗ Must be at least 12 characters'}
          </p>
        )}

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg border border-slate-200
                       text-slate-600 hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !strong || password !== confirm}
            className="text-sm px-4 py-2 rounded-lg bg-amber-600 text-white
                       hover:bg-amber-700 disabled:opacity-50 transition"
          >
            {loading ? 'Resetting…' : 'Reset Password'}
          </button>
        </div>
      </div>
    </div>
  )
}
