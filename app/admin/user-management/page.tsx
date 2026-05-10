'use client'

import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { SearchInput } from '@/components/ui/SearchInput'
import { EmptyState } from '@/components/ui/EmptyState'
import { useSearch } from '@/hooks'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth'
import { logAction } from '@/lib/adminLogger'
import {
  listAllUsers,
  setUserActive,
  adminResetPassword,
} from './actions'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ManagedUser {
  id:          string
  email?:      string
  role:        string
  displayName: string
  isActive:    boolean
  lastSignIn?: string
  // Enriched from admin_presence
  presenceActive: boolean
  lastSeen?:      string
  // Derived from profile
  initials:    string
  avatarColor: string
  title?:      string
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PresenceDot({ isActive }: { isActive: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
      isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
      {isActive ? 'Active' : 'Inactive'}
    </span>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function UserManagementPage() {
  const { user } = useAuth()

  const [users,            setUsers]            = useState<ManagedUser[]>([])
  const [loading,          setLoading]          = useState(true)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [message,          setMessage]          = useState<{ type: 'info' | 'error'; text: string } | null>(null)

  // ── Searchable list (name, role, title) ──────────────────────────────────

  const { query, setQuery, filtered } = useSearch(users, ['displayName', 'role', 'title'] as any)

  const onlineCount = users.filter(u => u.presenceActive).length

  // ── Load users + presence ─────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // listAllUsers() is a server action — returns auth users enriched with profiles
      const raw = await listAllUsers()

      // Also fetch presence for all users from admin_presence (client-side, uses RLS)
      const supabase = createClient()
      const { data: presenceRows } = await supabase
        .from('admin_presence')
        .select('user_id, is_active, last_seen')

      const presenceMap = new Map(
        (presenceRows ?? []).map(p => [p.user_id, p])
      )

      // Fetch profile display details (initials, avatar_color, title) in one query
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, initials, avatar_color, title')

      const profileMap = new Map(
        (profileRows ?? []).map(p => [p.id, p])
      )

      setUsers(
        (raw as Omit<ManagedUser, 'presenceActive' | 'lastSeen' | 'initials' | 'avatarColor' | 'title'>[]).map(u => {
          const presence = presenceMap.get(u.id)
          const profile  = profileMap.get(u.id)
          return {
            ...u,
            presenceActive: presence?.is_active ?? false,
            lastSeen:       presence?.last_seen  ?? undefined,
            initials:       profile?.initials    ?? u.role.slice(0, 2).toUpperCase(),
            avatarColor:    profile?.avatar_color ?? '#6b7280',
            title:          profile?.title        ?? undefined,
          }
        })
      )
    } catch (e: unknown) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Failed to load users.' })
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Initial load + realtime presence subscription ────────────────────────

  useEffect(() => {
    void load()

    const supabase = createClient()
    const channel = supabase
      .channel('user_mgmt_presence_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_presence' }, () => {
        void load()
      })
      .subscribe(status => setRealtimeConnected(status === 'SUBSCRIBED'))

    return () => { supabase.removeChannel(channel) }
  }, [load])

  // ── Actions ───────────────────────────────────────────────────────────────

  async function toggleActive(userId: string, currentlyActive: boolean, displayName: string) {
    try {
      await setUserActive(userId, !currentlyActive)
      const verb = currentlyActive ? 'deactivated' : 'activated'
      setMessage({ type: 'info', text: `${displayName} has been ${verb}.` })
      await logAction(
        currentlyActive ? 'archive_document' : 'approve_request',
        `Admin ${user?.role ?? ''} ${verb} account for ${displayName}`
      )
      await load()
    } catch (e: unknown) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Action failed.' })
    }
  }

  async function resetPassword(userId: string, displayName: string) {
    const newPass = prompt(`Enter new password for ${displayName} (min 12 characters):`)
    if (!newPass) return
    try {
      await adminResetPassword(userId, newPass)
      setMessage({ type: 'info', text: `Password reset for ${displayName}.` })
      await logAction('edit_document', `Admin ${user?.role ?? ''} reset password for ${displayName}`)
    } catch (e: unknown) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Reset failed.' })
    }
  }

  // ── Role level badge ──────────────────────────────────────────────────────

  const roleLevelColor: Record<string, string> = {
    admin:       'bg-violet-100 text-violet-700',
    PD:          'bg-red-100 text-red-700',
    DPDA:        'bg-amber-100 text-amber-700',
    DPDO:        'bg-amber-100 text-amber-700',
    P1:          'bg-blue-100 text-blue-700',
  }

  function roleBadgeClass(role: string) {
    return roleLevelColor[role] ?? 'bg-slate-100 text-slate-500'
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  const activeAccountCount = users.filter(u => u.isActive).length

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader title="User Management" />

      <div className="p-8 space-y-6">

        {/* Header row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm border-[1.5px] bg-white border-blue-500 text-blue-700 shadow-sm">
            👥 Admin Accounts
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              {onlineCount} online
            </span>
          </div>

          <div className="ml-auto">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all ${
              realtimeConnected
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-slate-50 border-slate-200 text-slate-400'
            }`}>
              <span className={`w-2 h-2 rounded-full ${realtimeConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
              {realtimeConnected ? 'Live' : 'Connecting…'}
            </div>
          </div>
        </div>

        {/* Feedback banner */}
        {message && (
          <div className={`rounded-xl px-4 py-3 text-sm font-medium border ${
            message.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-blue-50 border-blue-200 text-blue-700'
          }`}>
            {message.text}
            <button
              onClick={() => setMessage(null)}
              className="ml-3 text-xs underline opacity-70 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="space-y-4">

          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Total Accounts', value: users.length,                                   icon: '👥', bg: 'bg-blue-50',    num: 'text-blue-700'    },
              { label: 'Online Now',     value: onlineCount,                                     icon: '🟢', bg: 'bg-emerald-50', num: 'text-emerald-700' },
              { label: 'Offline',        value: users.length - onlineCount,                      icon: '⚫', bg: 'bg-slate-50',   num: 'text-slate-600'   },
              { label: 'Enabled',        value: activeAccountCount,                              icon: '🔓', bg: 'bg-violet-50',  num: 'text-violet-700'  },
            ].map(s => (
              <div key={s.label} className={`${s.bg} border border-slate-200 rounded-xl px-5 py-4 flex items-center gap-3`}>
                <span className="text-2xl">{s.icon}</span>
                <div>
                  <div className={`text-2xl font-extrabold ${s.num}`}>{s.value}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Table card */}
          <div className="bg-white border-[1.5px] border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-6 py-4 border-b border-slate-100 bg-slate-50">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Search accounts…"
                className="max-w-xs flex-1"
              />
              <span className="text-xs text-slate-400 ml-auto">
                {users.length} accounts · Supabase Auth
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState icon="👥" title="No users found" description="Try a different search term." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['Account', 'Role', 'Status', 'Last Sign-In', 'Presence', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(filtered as ManagedUser[]).map(u => (
                      <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50 transition">

                        {/* Account */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="relative">
                              <Avatar
                                initials={u.initials}
                                color={u.avatarColor}
                                size="sm"
                              />
                              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                                u.presenceActive ? 'bg-emerald-500' : 'bg-slate-300'
                              }`} />
                            </div>
                            <div>
                              <span className="font-semibold text-sm text-slate-800">{u.displayName}</span>
                              <p className="text-[11px] text-slate-400">{u.email}</p>
                            </div>
                          </div>
                        </td>

                        {/* Role */}
                        <td className="px-4 py-3.5">
                          <Badge className={roleBadgeClass(u.role)}>
                            {u.role}
                          </Badge>
                          {u.title && (
                            <p className="text-[10px] text-slate-400 mt-0.5">{u.title}</p>
                          )}
                        </td>

                        {/* Account enabled/disabled */}
                        <td className="px-4 py-3.5">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                            u.isActive
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {u.isActive ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>

                        {/* Last sign-in */}
                        <td className="px-4 py-3.5 text-[11px] text-slate-500">
                          {u.lastSignIn
                            ? new Date(u.lastSignIn).toLocaleString('en-PH', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })
                            : <span className="text-slate-300">Never</span>}
                        </td>

                        {/* Realtime presence */}
                        <td className="px-4 py-3.5">
                          <PresenceDot isActive={u.presenceActive} />
                          {u.lastSeen && (
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              {u.presenceActive
                                ? 'Online now'
                                : `Last: ${new Date(u.lastSeen).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`}
                            </p>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => toggleActive(u.id, u.isActive, u.displayName)}
                              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition ${
                                u.isActive
                                  ? 'border-red-200 text-red-600 hover:bg-red-50'
                                  : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                              }`}
                            >
                              {u.isActive ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              onClick={() => resetPassword(u.id, u.displayName)}
                              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 transition"
                            >
                              Reset PW
                            </button>
                          </div>
                        </td>

                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
              <p className="text-[11px] text-slate-400">
                🔒 Accounts are managed via Supabase Auth. Disabling an account immediately signs the user out everywhere.
                Passwords are reset by the system administrator only.
              </p>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}