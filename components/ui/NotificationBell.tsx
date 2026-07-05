'use client'
// components/ui/NotificationBell.tsx
// Real-time notification dropdown for admin sidebar

import { useEffect, useState, useCallback, useRef } from 'react'
import { Bell } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  type AdminNotification,
} from '@/lib/rbac'
import { supabase } from '@/lib/supabase'
import type { AdminRole } from '@/lib/auth'

const TYPE_ICONS: Record<AdminNotification['type'], string> = {
  info: 'ℹ️',
  approval_request: '📋',
  approved: '✅',
  rejected: '❌',
}

const TYPE_COLORS: Record<AdminNotification['type'], string> = {
  info: 'text-blue-600',
  approval_request: 'text-amber-600',
  approved: 'text-emerald-600',
  rejected: 'text-red-600',
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function NotificationBell() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<AdminNotification[]>([])
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const unread = notifications.filter(n => !n.is_read).length

  const load = useCallback(async () => {
    if (!user) return
    const data = await getNotifications(user.role as AdminRole)
    setNotifications(data)
  }, [user])

  useEffect(() => {
    load()

    if (!user) return
    const channel = supabase
      .channel(`notifications_${user.role}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'admin_notifications',
          filter: `admin_id=eq.${user.role}`,
        },
        (payload) => {
          setNotifications(prev => [payload.new as AdminNotification, ...prev])
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user, load])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  async function handleRead(notif: AdminNotification) {
    if (!notif.is_read) {
      await markAsRead(notif.id)
      setNotifications(prev =>
        prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n)
      )
    }
  }

  async function handleMarkAll() {
    if (!user) return
    await markAllAsRead(user.role as AdminRole)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  if (!user) return null

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition"
        title="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border border-[#0f1c35]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 md:left-10 bottom-0 z-[200] w-[calc(100vw-2rem)] max-w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-fade-up">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h3 className="text-sm font-bold text-slate-800">Notifications</h3>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={handleMarkAll}
                  className="text-[11px] text-blue-600 hover:underline font-medium"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-base font-bold leading-none"
              >×</button>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-80">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Bell size={28} className="text-slate-300 mb-2" />
                <p className="text-sm text-slate-400">No notifications yet</p>
              </div>
            ) : (
              notifications.map(notif => (
                <button
                  key={notif.id}
                  onClick={() => handleRead(notif)}
                  className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition ${
                    !notif.is_read ? 'bg-blue-50/40' : ''
                  }`}
                >
                  <span className="text-base flex-shrink-0 mt-0.5">
                    {TYPE_ICONS[notif.type]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-snug font-medium ${
                      notif.is_read ? 'text-slate-600' : 'text-slate-800'
                    }`}>
                      {notif.message}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {timeAgo(notif.created_at)}
                    </p>
                  </div>
                  {!notif.is_read && (
                    <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1.5" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}