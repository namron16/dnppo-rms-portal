'use client'
import { useState } from 'react'
import { deleteAccount } from './actions'

interface Props {
  userId:      string
  role:        string
  displayName: string
  email:       string
  onClose:     () => void
  onSuccess:   () => void
}

export function DeleteAccountModal({ userId, role, displayName, email, onClose, onSuccess }: Props) {
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const isConfirmed = confirm.trim().toUpperCase() === role.toUpperCase()

  async function handleDelete() {
    if (!isConfirmed) return
    setError('')
    setLoading(true)
    try {
      await deleteAccount(userId, role)
      onSuccess()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete account.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        <div className="px-6 py-4 border-b border-red-100 bg-red-50 flex items-center gap-3">
          <span className="text-2xl">🗑️</span>
          <div>
            <h2 className="text-base font-bold text-red-700">Delete Account</h2>
            <p className="text-xs text-red-500">This action is permanent and cannot be undone.</p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
              ❌ {error}
            </div>
          )}

          {/* Account being deleted */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 space-y-1">
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Account to delete</p>
            <p className="text-sm font-bold text-slate-800">{displayName}</p>
            <p className="text-xs text-slate-500">{role} · {email}</p>
          </div>

          {/* What will be deleted */}
          <div className="text-xs text-slate-600 space-y-1">
            <p className="font-semibold text-slate-700">The following will be permanently removed:</p>
            <ul className="list-disc pl-4 space-y-0.5 text-slate-500">
              <li>Supabase auth login (user cannot sign in anymore)</li>
              <li>Profile record from the database</li>
              <li>Google Drive pool slot</li>
              <li>Role entry in the role registry</li>
            </ul>
            <p className="text-slate-500 mt-1">
              Activity log history entries will be <strong>kept</strong> for audit purposes.
            </p>
          </div>

          {/* Google Console reminder */}
          <div className="px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 leading-relaxed">
            <strong>⚠️ After deleting:</strong> Go to <strong>Google Cloud Console → APIs &amp; Services
            → OAuth consent screen → Test Users</strong> and remove <strong>{email}</strong> from the list.
            If you don't, the email slot stays occupied unnecessarily.
          </div>

          {/* Confirmation input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Type <span className="font-mono bg-slate-100 px-1 rounded">{role}</span> to confirm deletion:
            </label>
            <input
              type="text"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder={`Type ${role} here`}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!isConfirmed || loading}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-40 flex items-center gap-2 transition"
          >
            {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {loading ? 'Deleting…' : '🗑️ Permanently Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}