'use client'

import { useState } from 'react'

interface Props {
  userId:      string
  displayName: string
  currentEmail?: string
  onClose:     () => void
  onSuccess:   (newEmail: string) => void
}

export function EditEmailModal({ userId, displayName, currentEmail, onClose, onSuccess }: Props) {
  const [email,   setEmail]   = useState(currentEmail ?? '')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSubmit() {
    setLoading(true)
    setError(null)
    try {
      const { adminUpdateEmail } = await import('./actions')
      await adminUpdateEmail(userId, email)
      onSuccess(email)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update email.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-base font-bold text-slate-800">
          Edit Email — <span className="text-blue-700">{displayName}</span>
        </h2>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            New Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="user@ddnppo.gov.ph"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <p className="text-[11px] text-slate-400">
          The email is updated immediately. The user may receive a confirmation email
          depending on your Supabase Auth settings.
        </p>

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
            disabled={loading || !email}
            className="text-sm px-4 py-2 rounded-lg bg-blue-600 text-white
                       hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {loading ? 'Saving…' : 'Save Email'}
          </button>
        </div>
      </div>
    </div>
  )
}
