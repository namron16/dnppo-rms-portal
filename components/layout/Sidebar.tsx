'use client'
// components/layout/Sidebar.tsx — Updated with clickable profile + ProfileSettingsModal

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import {createClient} from '@/lib/supabase/client'
import LogoutConfirmModal from '@/components/modals/LogoutConfirmModal'
import { ProfileSettingsModal } from '@/components/modals/ProfileSettingsModal'

interface NavItem {
  label: string
  icon: string
  href: string
}

const DOC_NAV: NavItem[] = [
  { label: 'Master Documents',      icon: '📁', href: '/admin/master' },
  { label: 'Admin Orders',          icon: '📋', href: '/admin/admin-orders' },
  { label: '201 Files',             icon: '📔', href: '/admin/personnel' },
  { label: 'Daily Journal',         icon: '📒', href: '/admin/daily-journals' },
  { label: 'Organization',          icon: '🏛️', href: '/admin/organization' },
  { label: 'e-Library',             icon: '📚', href: '/admin/e-library' },
  { label: 'Forwarded Files', icon: '📥', href: '/admin/forwarded' },
  { label: 'Archive',         icon: '🗄️', href: '/admin/archive' },
]
const P2_NAV: NavItem[] = [
  { label: 'Master Documents',      icon: '📁', href: '/admin/master' },
  { label: 'Admin Orders',          icon: '📋', href: '/admin/admin-orders' },
  { label: 'Classified Documents',  icon: '🛡️', href: '/admin/classified-documents' },
  { label: 'Organization',          icon: '🏛️', href: '/admin/organization' },
  { label: 'e-Library',             icon: '📚', href: '/admin/e-library' },
  { label: 'Forwarded Files', icon: '📥', href: '/admin/forwarded' },
  { label: 'Archive',         icon: '🗄️', href: '/admin/archive' },
]

const VIEWER_NAV: NavItem[] = [
  { label: 'Master Documents',      icon: '📁', href: '/admin/master' },
  { label: 'Admin Orders',          icon: '📋', href: '/admin/admin-orders' },
  { label: 'Daily Journal',         icon: '📒', href: '/admin/daily-journals' },
  { label: 'Organization',          icon: '🏛️', href: '/admin/organization' },
  { label: 'e-Library',             icon: '📚', href: '/admin/e-library' },
   { label: 'Forwarded Files', icon: '📥', href: '/admin/forwarded' },
   { label: 'Archive',         icon: '🗄️', href: '/admin/archive' },
]



const ADMIN_NAV: NavItem[] = [
  { label: 'Log History',     icon: '📊', href: '/admin/log-history' },
  { label: 'User Management', icon: '👥', href: '/admin/user-management' },
  { label: 'Drive Storage',   icon: '☁️', href: '/admin/gdrive' }, 
  { label: 'Backup & Recovery', icon: '🛡️', href: '/admin/backup-recovery' },
]

const DPDA_NAV: NavItem[] = [
  { label: 'Master Documents',      icon: '📁', href: '/admin/master' },
  { label: 'Admin Orders',          icon: '📋', href: '/admin/admin-orders' },
  { label: 'Daily Journal',         icon: '📒', href: '/admin/daily-journals' },
  { label: 'Organization',          icon: '🏛️', href: '/admin/organization' },
  { label: 'e-Library',             icon: '📚', href: '/admin/e-library' },
  { label: 'Archive',               icon: '🗄️', href: '/admin/archive' },
  { label: 'Forwarded',             icon: '📮', href: '/admin/dpda-inbox' },
]

function NavLink({ item, active, onNavigate, badgeCount }: {
  item: NavItem
  active: boolean
  onNavigate: (href: string) => void
  badgeCount?: number
}) {
  return (
    <Link
      href={item.href}
      onClick={() => onNavigate(item.href)}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-[background-color,color,border-color] duration-120 ease-[cubic-bezier(0.22,1,0.36,1)] mb-1 group',
        active
          ? 'bg-blue-100 text-blue-700 border border-blue-200'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 border border-transparent'
      )}
    >
      <span className="w-5 h-5 flex items-center justify-center text-sm flex-shrink-0 group-hover:scale-110 transition-transform">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {badgeCount && badgeCount > 0 && (
        <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded-full min-w-[20px] text-center shadow-sm">
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </Link>
  )
}

export function Sidebar() {
  const { user, logout } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const router   = useRouter()
  const pathname = usePathname()

  const [showLogoutConfirm,  setShowLogoutConfirm]  = useState(false)
  const [showProfileSettings, setShowProfileSettings] = useState(false)
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [unreadInboxCount, setUnreadInboxCount] = useState(0)

  // Local overrides — updated after profile save
  const [localDisplayName, setLocalDisplayName] = useState<string | null>(null)
  const [localAvatarUrl,   setLocalAvatarUrl]   = useState<string | null>(null)

  // Reset local overrides when user changes (e.g. logout/login)
  useEffect(() => {
    setLocalDisplayName(null)
    setLocalAvatarUrl(null)
  }, [user?.id])

  useEffect(() => {
    setLocalDisplayName(null)
  }, [user?.name])

  useEffect(() => {
    setLocalAvatarUrl(null)
  }, [user?.avatarUrl])

  useEffect(() => {
    const allRoutes = [...DOC_NAV, ...ADMIN_NAV].map(item => item.href)
    allRoutes.forEach(href => router.prefetch(href))
  }, [router])

  useEffect(() => { setPendingHref(null) }, [pathname])

  // Fetch unread inbox count
  // Replace the "Fetch unread inbox count" useEffect with this:
  // AFTER — Supabase Realtime subscription
  useEffect(() => {
    if (!user) {
      setUnreadInboxCount(0)
      return
    }

    // 1. Fetch the initial count on mount
    const fetchCount = async () => {
      // AFTER
      const isDPDAUser = ['DPDA', 'DPDO'].includes(user.role)

      const query = supabase
        .from('forwarded_documents')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_role', user.role)

      const { count } = isDPDAUser
        ? await query.eq('dpda_status', 'pending')   // DPDA uses dpda_status
        : await query.eq('status', 'pending')         // everyone else uses status
      setUnreadInboxCount(count ?? 0)
    }

    fetchCount()

    // 2. Subscribe to any INSERT or UPDATE on forwarded_documents
    //    filtered to rows where recipient_role matches this user
    const channel = supabase
      .channel('forwarded-inbox-count')
      .on(
        'postgres_changes',
        {
          event: '*',   // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'forwarded_documents',
          filter: `recipient_role=eq.${user.role}`,
        },
        () => {
          // Re-fetch count whenever anything changes for this recipient
          fetchCount()
        }
      )
      .subscribe()

    // 3. Cleanup: unsubscribe when user logs out or component unmounts
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  // ── Realtime: sync profile changes across tabs/devices ──────────────────
  useEffect(() => {
    if (!user) return

    const fetchLatestProfile = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) return

      const { data } = await supabase
        .from('profiles')
        .select('display_name, avatar_url')
        .eq('id', authUser.id)
        .single()

      if (data) {
        if (data.display_name) setLocalDisplayName(data.display_name)
        if (data.avatar_url)   setLocalAvatarUrl(data.avatar_url)
      }
    }

    const channel = supabase
      .channel('profile-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
        },
        async (payload) => {
          // Only react to updates for the current user's row
          const { data: { user: authUser } } = await supabase.auth.getUser()
          if (payload.new.id !== authUser?.id) return

          const { display_name, avatar_url } = payload.new as {
            display_name?: string
            avatar_url?: string
          }
          if (display_name) setLocalDisplayName(display_name)
          if (avatar_url)   setLocalAvatarUrl(avatar_url)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  async function handleLogoutConfirm() {
    setShowLogoutConfirm(false)
    await logout()
    router.replace('/login')
  }

  function handleProfileUpdated({ displayName, avatarUrl }: { displayName?: string; avatarUrl?: string }) {
    if (displayName) setLocalDisplayName(displayName)
    if (avatarUrl)   setLocalAvatarUrl(avatarUrl)
  }

  const isAdmin = user && ['admin'].includes(user.role)
  const isDPDA = user && ['DPDA', 'DPDO'].includes(user.role)
  const canSeeP2    = user?.role === 'P2'
  const isViewerNo201 = ['P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'PPSMU', 'WCPD'].includes(user?.role ?? '')
  const isP1        = user?.role === 'P1'

  // Effective display values (auth sync > temporary local override)
  const displayName = localDisplayName ?? user?.name ?? user?.role ?? ''
  const avatarUrl   = localAvatarUrl ?? user?.avatarUrl ?? null
  const initials    = displayName
    .split(' ')
    .filter(Boolean)
    .map((n: string) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || (user?.initials ?? '??')

  return (
    <>
      <aside className="sidebar-fixed bg-white border-r border-gray-200">
        {/* ── Logo ── */}
        <div className="px-5 py-6 border-b border-gray-200 flex items-center gap-3">
          <img 
            src="/assets/polaris-logo.png" 
            alt="Polaris Logo" 
            className="w-10 h-10 flex-shrink-0 object-cover"
          />
          <div className="leading-tight">
            <div className="text-gray-900 text-[13px] font-bold tracking-tight">DNPPO Records</div>
            <div className="text-gray-500 text-[11px] font-medium">Davao Del Norte</div>
          </div>
        </div>

        {/* ── Clickable Profile Card ── */}
        {user && (
          <button
            onClick={() => setShowProfileSettings(true)}
            className="mx-3 mt-4 px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 transition-all duration-150 w-[calc(100%-24px)] text-left group cursor-pointer shadow-sm"
            title="Click to open profile settings"
          >
            <div className="flex items-center gap-3">
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="w-9 h-9 rounded-full object-cover border-2 border-gray-300"
                  />
                ) : (
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold text-white border-2 border-gray-300 transition-transform group-hover:scale-105"
                    style={{ background: user.avatarColor }}
                  >
                    {initials}
                  </div>
                )}
                {/* Online dot */}
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-gray-900 text-[13px] font-semibold truncate leading-tight">
                  {displayName}
                </p>
                <p className="text-gray-500 text-[11px] truncate">{user.title}</p>
              </div>

              {/* Settings caret */}
              <div className="flex-shrink-0 flex items-center gap-1 text-gray-400 group-hover:text-blue-600 transition-colors">
                {isP1 && (
                  <span className="text-[9px] font-bold px-2 py-1 bg-violet-100 text-violet-700 rounded-full border border-violet-200">
                    SUPER
                  </span>
                )}
                {/* Pencil icon hint */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-50 group-hover:opacity-100 transition-opacity">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </div>
            </div>
          </button>
        )}

        {/* ── Documents nav ── */}
        {!isAdmin && !isDPDA && (
          <div className="px-3 pt-5 pb-2">
          <div className="px-3 mb-3 text-[11px] font-bold tracking-wider uppercase text-gray-400">Documents</div>
          {canSeeP2
            ? P2_NAV.map(item => (
                <NavLink key={item.href} item={item}
                  active={pathname === item.href || pendingHref === item.href}
                  onNavigate={setPendingHref}
                  badgeCount={item.href === '/admin/forwarded' ? unreadInboxCount : undefined} />
              ))
            : isViewerNo201
              ? VIEWER_NAV.map(item => (
                  <NavLink key={item.href} item={item}
                    active={pathname === item.href || pendingHref === item.href}
                    onNavigate={setPendingHref}
                    badgeCount={item.href === '/admin/forwarded' ? unreadInboxCount : undefined} />
                ))
            : DOC_NAV.map(item => (
                <NavLink key={item.href} item={item}
                  active={pathname === item.href || pendingHref === item.href}
                  onNavigate={setPendingHref}
                  badgeCount={item.href === '/admin/forwarded' ? unreadInboxCount : undefined} />
              ))  
          }
          </div>
        )}

        {/* ── DPDA nav ── */}
        {isDPDA && (
          <div className="px-3 pt-5 pb-2">
            <div className="px-3 mb-3 text-[11px] font-bold tracking-wider uppercase text-gray-400">Management</div>
            
            {DPDA_NAV.map(item => (
              <NavLink key={item.href} item={item}
                active={pathname === item.href || pendingHref === item.href}
                onNavigate={setPendingHref}
                badgeCount={item.href === '/admin/dpda-inbox' ? unreadInboxCount : undefined} />
            ))}
          </div>
        )}
       

        {isAdmin && (
          <div className="px-3 pt-3 pb-2">
            <div className="px-3 mb-3 text-[11px] font-bold tracking-wider uppercase text-gray-400">Administration</div>
            {ADMIN_NAV.map(item => (
              <NavLink key={item.href} item={item}
                active={pathname === item.href || pendingHref === item.href}
                onNavigate={setPendingHref}
                badgeCount={item.href === '/admin/forwarded' ? unreadInboxCount : undefined} />
            ))}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-auto px-3 py-4 border-t border-gray-200">
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-gray-600 hover:text-red-600 hover:bg-red-50 transition-colors text-[13px] font-medium group"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Modals ── */}
      <LogoutConfirmModal
        open={showLogoutConfirm}
        onConfirm={handleLogoutConfirm}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      <ProfileSettingsModal
        open={showProfileSettings}
        onClose={() => setShowProfileSettings(false)}
        user={user}
        onProfileUpdated={handleProfileUpdated}
      />
    </>
  )
}