'use client'
// app/admin/system-settings/page.tsx
// Super-admin only. Controls app-wide settings — starting with session duration.
//
// How it works:
//   1. On load, fetch current session_duration_hours from system_settings.
//   2. Admin picks a new duration from the dropdown and clicks Save.
//   3. We call the update_session_duration RPC which:
//        a) Updates system_settings
//        b) Pulls back expires_at on ALL active sessions that now exceed the limit
//      So users already logged in get kicked on their next 30-second poll.

import { useEffect, useState } from 'react'
import { createClient }        from '@/lib/supabase/client'
import { useAuth }             from '@/lib/auth'
import { useRouter }           from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SystemSettings {
  session_duration_hours: number
  updated_at:             string
  updated_by:             string
}

// ── Duration options shown in the dropdown ────────────────────────────────────
// Label is what the user sees; value is what gets saved to the DB.
const DURATION_OPTIONS: { label: string; value: number }[] = [
  { label: '4 hours',   value: 4   },
  { label: '8 hours',   value: 8   },
  { label: '12 hours',  value: 12  },
  { label: '24 hours',  value: 24  },
  { label: '48 hours',  value: 48  },
  { label: '7 days',    value: 168 },
]

// ── Helper: readable date ─────────────────────────────────────────────────────
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    year:   'numeric',
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SystemSettingsPage() {
  const { user }   = useAuth()
  const router     = useRouter()
  const supabase   = createClient()

  const [settings,     setSettings]     = useState<SystemSettings | null>(null)
  const [selected,     setSelected]     = useState<number>(24)
  const [isFetching,   setIsFetching]   = useState(true)
  const [isSaving,     setIsSaving]     = useState(false)
  const [saveStatus,   setSaveStatus]   = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  // ── Guard: only admin may see this page ────────────────────────────────────
  useEffect(() => {
    if (user && user.role !== 'admin') {
      router.replace('/admin/log-history')
    }
  }, [user, router])

  // ── Fetch current settings on mount ───────────────────────────────────────
  useEffect(() => {
    async function load() {
      setIsFetching(true)
      const { data, error } = await supabase
        .from('system_settings')
        .select('session_duration_hours, updated_at, updated_by')
        .eq('id', 1)
        .single()

      if (!error && data) {
        setSettings(data as SystemSettings)
        setSelected(data.session_duration_hours)
      }
      setIsFetching(false)
    }
    void load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save handler ───────────────────────────────────────────────────────────
  async function handleSave() {
    if (!user) return
    setIsSaving(true)
    setSaveStatus('idle')
    setErrorMessage('')

    // Call the SECURITY DEFINER RPC which:
    //   • Updates system_settings
    //   • Shortens expires_at on any session that now exceeds the new limit
    const { error } = await supabase.rpc('update_session_duration', {
      p_hours:    selected,
      p_admin_by: user.role,
    })

    if (error) {
      setSaveStatus('error')
      setErrorMessage(error.message)
      setIsSaving(false)
      return
    }

    // Refresh local state so the "last updated" line reflects the change
    const { data } = await supabase
      .from('system_settings')
      .select('session_duration_hours, updated_at, updated_by')
      .eq('id', 1)
      .single()

    if (data) setSettings(data as SystemSettings)
    setSaveStatus('success')
    setIsSaving(false)

    // Auto-clear the success banner after 4 seconds
    setTimeout(() => setSaveStatus('idle'), 4000)
  }

  const hasChanged = settings?.session_duration_hours !== selected

  // ── Render ─────────────────────────────────────────────────────────────────

  if (user?.role !== 'admin') return null  // flash-of-content guard

  return (
    <div className="p-6 max-w-3xl mx-auto">

      {/* ── Page header ── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">System Settings</h1>
        <p className="text-gray-500 text-sm mt-1">
          App-wide configuration. Changes take effect immediately for all users.
        </p>
      </div>

      {/* ── Session Duration card ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

        {/* Card header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
          <span className="text-xl">🔐</span>
          <div>
            <h2 className="text-[15px] font-semibold text-gray-900">Session Duration</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              How long a user stays logged in before being automatically signed out.
            </p>
          </div>
        </div>

        {/* Card body */}
        <div className="px-6 py-5">

          {isFetching ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
              <span className="animate-spin">⏳</span> Loading current settings…
            </div>
          ) : (
            <>
              {/* Explanation box — plain-English for non-technical admins */}
              <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-5 text-[13px] text-blue-700 leading-relaxed">
                <strong>How this works:</strong> Every time someone logs in, they receive
                a session that lasts this long. When you change the duration, anyone already
                logged in whose session exceeds the new limit will be signed out automatically
                within 30 seconds — no action needed on their end.
              </div>

              {/* Dropdown */}
              <div className="flex items-center gap-4 mb-2">
                <label
                  htmlFor="session-duration"
                  className="text-[13px] font-medium text-gray-700 w-44 flex-shrink-0"
                >
                  Max session length
                </label>
                <select
                  id="session-duration"
                  value={selected}
                  onChange={e => {
                    setSelected(Number(e.target.value))
                    setSaveStatus('idle')
                  }}
                  className="
                    border border-gray-300 rounded-lg px-3 py-2 text-[13px] text-gray-900
                    bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500
                    focus:border-blue-500 transition-colors cursor-pointer
                  "
                >
                  {DURATION_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Last updated info */}
              {settings && (
                <p className="text-[11px] text-gray-400 mb-5 ml-48">
                  Last updated {fmtDate(settings.updated_at)} by <strong>{settings.updated_by}</strong>
                </p>
              )}

              {/* Warning when shortening — clarifies the immediate-kick behaviour */}
              {hasChanged && selected < (settings?.session_duration_hours ?? 24) && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-[12px] text-amber-800 flex items-start gap-2">
                  <span className="mt-0.5 flex-shrink-0">⚠️</span>
                  <span>
                    You're <strong>reducing</strong> the session duration. Any user currently
                    logged in for longer than <strong>{DURATION_OPTIONS.find(o => o.value === selected)?.label}</strong> will
                    be signed out within 30 seconds of saving.
                  </span>
                </div>
              )}

              {/* Success banner */}
              {saveStatus === 'success' && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 text-[13px] text-green-700 flex items-center gap-2">
                  <span>✅</span>
                  Session duration updated. All active sessions have been adjusted.
                </div>
              )}

              {/* Error banner */}
              {saveStatus === 'error' && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-[13px] text-red-700 flex items-center gap-2">
                  <span>❌</span>
                  {errorMessage || 'Something went wrong. Please try again.'}
                </div>
              )}

              {/* Save button */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !hasChanged}
                  className="
                    px-4 py-2 rounded-lg text-[13px] font-semibold transition-all
                    bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]
                    disabled:opacity-40 disabled:cursor-not-allowed
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                  "
                >
                  {isSaving ? 'Saving…' : 'Save Changes'}
                </button>

                {!hasChanged && (
                  <span className="text-[12px] text-gray-400">No changes to save</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Placeholder for future settings cards ── */}
      <div className="mt-6 border border-dashed border-gray-200 rounded-xl px-6 py-8 text-center text-gray-400 text-[13px]">
        More system settings can be added here in future updates.
      </div>

    </div>
  )
}