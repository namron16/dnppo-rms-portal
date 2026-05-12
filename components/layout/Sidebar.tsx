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
  { label: 'Forwarded Files', icon: '📥', href: '/admin/forwarded-files' },
  { label: 'Archive',         icon: '🗄️', href: '/admin/archive' },
]
const P2_NAV: NavItem[] = [
  { label: 'Master Documents',      icon: '📁', href: '/admin/master' },
  { label: 'Admin Orders',          icon: '📋', href: '/admin/admin-orders' },
  { label: 'Classified Documents',  icon: '🛡️', href: '/admin/classified-documents' },
  { label: 'Organization',          icon: '🏛️', href: '/admin/organization' },
  { label: 'e-Library',             icon: '📚', href: '/admin/e-library' },
  { label: 'Forwarded Files', icon: '📥', href: '/admin/forwarded-files' },
  { label: 'Archive',         icon: '🗄️', href: '/admin/archive' },
]

const VIEWER_NAV: NavItem[] = [
  { label: 'Master Documents',      icon: '📁', href: '/admin/master' },
  { label: 'Admin Orders',          icon: '📋', href: '/admin/admin-orders' },
  { label: 'Daily Journal',         icon: '📒', href: '/admin/daily-journals' },
  { label: 'Organization',          icon: '🏛️', href: '/admin/organization' },
  { label: 'e-Library',             icon: '📚', href: '/admin/e-library' },
   { label: 'Forwarded Files', icon: '📥', href: '/admin/forwarded-files' },
   { label: 'Archive',         icon: '🗄️', href: '/admin/archive' },
]



const ADMIN_NAV: NavItem[] = [
  { label: 'Log History',     icon: '📊', href: '/admin/log-history' },
  { label: 'User Management', icon: '👥', href: '/admin/user-management' },
  { label: 'Drive Storage',   icon: '☁️', href: '/admin/gdrive' }, 
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
        'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-[background-color,color] duration-120 ease-[cubic-bezier(0.22,1,0.36,1)] mb-0.5',
        active
          ? 'bg-blue-600 text-white'
          : 'text-white/60 hover:bg-white/10 hover:text-white'
      )}
    >
      <span className="w-5 text-center text-base">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {badgeCount && badgeCount > 0 && (
        <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
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
  useEffect(() => {
    if (!user) {
      setUnreadInboxCount(0)
      return
    }

    const fetchUnreadCount = async () => {
      const { count } = await supabase
        .from('inbox_items')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', user.role)
        .eq('status', 'unread')

      setUnreadInboxCount(count || 0)
    }

    fetchUnreadCount()

    // Set up real-time subscription
    const channel = supabase
      .channel('inbox_unread_count')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'inbox_items',
        filter: `recipient_id=eq.${user.role}`
      }, () => {
        fetchUnreadCount()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user])

  async function handleLogoutConfirm() {
    setShowLogoutConfirm(false)
    await logout()
    setTimeout(() => { router.replace('/login') }, 100)
  }

  function handleProfileUpdated({ displayName, avatarUrl }: { displayName?: string; avatarUrl?: string }) {
    if (displayName) setLocalDisplayName(displayName)
    if (avatarUrl)   setLocalAvatarUrl(avatarUrl)
  }

  const isAdmin = user && ['admin'].includes(user.role)
  const canSeeP2    = user?.role === 'P2'
  const isViewerNo201 = ['P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'].includes(user?.role ?? '')
  const isP1        = user?.role === 'P1'

  // Effective display values (auth sync > temporary local override)
  const displayName = user?.name ?? localDisplayName ?? user?.role ?? ''
  const avatarUrl   = user?.avatarUrl ?? localAvatarUrl ?? null
  const initials    = displayName
    .split(' ')
    .filter(Boolean)
    .map((n: string) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || (user?.initials ?? '??')

  return (
    <>
      <aside className="sidebar-fixed">
        {/* ── Logo ── */}
        <div className="px-5 py-5 border-b border-white/10 flex items-center gap-2.5">
          <div className="w-9 h-9 bg-yellow-400 rounded-lg flex items-center justify-center text-lg flex-shrink-0">🛡️</div>
          <div className="leading-tight">
            <div className="text-white text-[13px] font-bold tracking-tight">DNPPO Records System</div>
            <div className="text-white/40 text-[9.5px] uppercase tracking-widest font-medium">Davao Del Norte PPO</div>
          </div>
        </div>

        {/* ── Clickable Profile Card ── */}
        {user && (
          <button
            onClick={() => setShowProfileSettings(true)}
            className="mx-3 mt-3 px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all duration-150 w-[calc(100%-24px)] text-left group cursor-pointer"
            title="Click to open profile settings"
          >
            <div className="flex items-center gap-2.5">
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={displayName}
                    className="w-8 h-8 rounded-full object-cover border-2 border-white/20"
                  />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white border-2 border-white/20 transition-transform group-hover:scale-105"
                    style={{ background: user.avatarColor }}
                  >
                    {initials}
                  </div>
                )}
                {/* Online dot */}
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-[#0f1c35]" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-white text-[12px] font-semibold truncate leading-tight">
                  {displayName}
                </p>
                <p className="text-white/40 text-[10px] truncate">{user.title}</p>
              </div>

              {/* Settings caret */}
              <div className="flex-shrink-0 flex items-center gap-1 text-white/30 group-hover:text-white/60 transition-colors">
                {isP1 && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 bg-violet-500/30 text-violet-300 rounded-full border border-violet-500/30">
                    SUPER
                  </span>
                )}
                {/* Pencil icon hint */}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60 group-hover:opacity-100 transition-opacity">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </div>
            </div>

            {/* Hover hint */}
            <p className="text-white/20 text-[9px] mt-1.5 group-hover:text-white/40 transition-colors">
              ✏️ Click to edit profile &amp; settings
            </p>
          </button>
        )}

        {/* ── Documents nav ── */}
        {!isAdmin && (
          <div className="px-3 pt-5 pb-2">
          <div className="px-3 mb-2 text-[10px] font-bold tracking-widest uppercase text-white/30">Documents</div>
          {canSeeP2
            ? P2_NAV.map(item => (
                <NavLink key={item.href} item={item}
                  active={pathname === item.href || pendingHref === item.href}
                  onNavigate={setPendingHref}
                  badgeCount={item.href === '/admin/inbox' ? unreadInboxCount : undefined} />
              ))
            : isViewerNo201
              ? VIEWER_NAV.map(item => (
                  <NavLink key={item.href} item={item}
                    active={pathname === item.href || pendingHref === item.href}
                    onNavigate={setPendingHref}
                    badgeCount={item.href === '/admin/inbox' ? unreadInboxCount : undefined} />
                ))
            : DOC_NAV.map(item => (
                <NavLink key={item.href} item={item}
                  active={pathname === item.href || pendingHref === item.href}
                  onNavigate={setPendingHref}
                  badgeCount={item.href === '/admin/inbox' && !isP1 ? unreadInboxCount : undefined} />
              ))  
          }
          </div>
        )}
       

        {isAdmin && (
          <div className="px-3 pt-3 pb-2">
            <div className="px-3 mb-2 text-[10px] font-bold tracking-widests uppercase text-white/30">Administration</div>
            {ADMIN_NAV.map(item => (
              <NavLink key={item.href} item={item}
                active={pathname === item.href || pendingHref === item.href}
                onNavigate={setPendingHref}
                badgeCount={item.href === '/admin/inbox' && !isP1 ? unreadInboxCount : undefined} />
            ))}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="mt-auto px-3 py-4 border-t border-white/10">
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-white/40 hover:text-red-400 hover:bg-red-500/10 transition text-[12px] font-medium"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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