'use client'
// lib/auth.tsx

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { createClient }                         from './supabase/client'
import { setCurrentLogger, logLogin }           from './adminLogger'
import { clearSession, registerSession }        from './sessionLock'
import { setAdminActive, setAdminInactive }     from './accessRequests'
import type { Session, User }                   from '@supabase/supabase-js'

export type AdminRole = string
export type RoleLevel = 'head' | 'deputy' | 'super_admin' | 'viewer' | 'admin'

export interface AdminUser {
  id:          string
  role:        AdminRole
  email:       string
  name:        string
  title:       string
  level:       RoleLevel
  initials:    string
  avatarColor: string
  avatarUrl?:  string
  // FIX: added so AuthGuard can build a RoleInfo object for route checks
  nav_group:     string
  is_viewer_only: boolean
  permissions: {
    canUpload:           boolean
    canApproveReview:    boolean
    canApproveFinal:     boolean
    canManageUsers:      boolean
    canManageVisibility: boolean
    canViewAll:          boolean
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function permissionsForRole(role: AdminRole): AdminUser['permissions'] {
  switch (role) {
    case 'admin':
      return { canUpload: false, canApproveReview: false, canApproveFinal: false,
               canManageUsers: true, canManageVisibility: false, canViewAll: true }
    case 'PD':
      return { canUpload: false, canApproveReview: false, canApproveFinal: true,
               canManageUsers: false, canManageVisibility: false, canViewAll: true }
    case 'DPDA': case 'DPDO':
      return { canUpload: false, canApproveReview: true, canApproveFinal: false,
               canManageUsers: false, canManageVisibility: false, canViewAll: true }
    case 'P1':
      return { canUpload: true, canApproveReview: false, canApproveFinal: false,
               canManageUsers: true, canManageVisibility: true, canViewAll: true }
    default:
      return { canUpload: true, canApproveReview: false, canApproveFinal: false,
               canManageUsers: false, canManageVisibility: false, canViewAll: true }
  }
}

function levelForRole(role: AdminRole): RoleLevel {
  if (role === 'admin')                   return 'super_admin'
  if (role === 'DPDA' || role === 'DPDO') return 'deputy'
  return 'admin'
}

// FIX: infer nav_group from hardcoded role names as a fallback for accounts
// that pre-date the dynamic role system (no nav_group in user_metadata yet).
function inferNavGroup(role: AdminRole): string {
  if (role === 'admin')                   return 'admin'
  if (role === 'DPDA' || role === 'DPDO') return 'dpda-dpdo'
  return 'documents'
}

interface ProfileRow {
  role:         string
  display_name: string | null
  title:        string | null
  initials:     string | null
  avatar_color: string | null
  avatar_url:   string | null
  is_active:    boolean
}

// FIX: buildAdminUser now accepts user_metadata so it can read nav_group
// and is_viewer_only from the JWT instead of guessing from the role name.
function buildAdminUser(
  user: User,
  profile: ProfileRow,
  metadata?: Record<string, unknown>,
): AdminUser {
  const role = profile.role as AdminRole
  return {
    id:             user.id,
    role,
    email:          user.email ?? '',
    name:           profile.display_name ?? role,
    title:          profile.title        ?? role,
    level:          levelForRole(role),
    initials:       profile.initials     ?? role.slice(0, 2).toUpperCase(),
    avatarColor:    profile.avatar_color ?? '#6b7280',
    avatarUrl:      profile.avatar_url   ?? undefined,
    // Read from JWT metadata first, fall back to inference for old accounts
    nav_group:      (metadata?.nav_group     as string  | undefined) ?? inferNavGroup(role),
    is_viewer_only: (metadata?.is_viewer_only as boolean | undefined) ?? true,
    permissions:    permissionsForRole(role),
  }
}

// ── Profile fetch ─────────────────────────────────────────────────────────────

async function fetchProfile(
  supabase: ReturnType<typeof createClient>,
  user: User,
): Promise<AdminUser | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('role, display_name, title, initials, avatar_color, avatar_url')
      .eq('id', user.id)
      .single()
    if (error || !data) return null
    // FIX: pass user_metadata so nav_group is read from the JWT
    return buildAdminUser(user, data as ProfileRow, user.user_metadata)
  } catch {
    return null
  }
}

// ── Email masking helper ──────────────────────────────────────────────────────

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const visible = local.slice(0, 1)
  const masked  = local.length > 1 ? '*'.repeat(Math.min(local.length - 1, 4)) : ''
  return `${visible}${masked}@${domain}`
}

// ── Safe sign-out helpers ─────────────────────────────────────────────────────

async function safeSignOutLocal(supabase: ReturnType<typeof createClient>): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' })
  await new Promise<void>(r => setTimeout(r, 200))
}

async function safeSignOutGlobal(supabase: ReturnType<typeof createClient>): Promise<void> {
  await supabase.auth.signOut({ scope: 'global' })
  await new Promise<void>(r => setTimeout(r, 200))
}

// ── Context ───────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user:           AdminUser | null
  session:        Session | null
  isLoading:      boolean
  loginPassword:  (role: string, password: string) => Promise<{ error: string | null }>
  logout:         () => Promise<void>
  changePassword: (current: string, next: string)  => Promise<{ error: string | null }>
  sendPasswordResetOTP: (role: string) => Promise<{ maskedEmail: string | null; error: string | null }>
  verifyOTPAndReset:    (role: string, token: string, newPassword: string) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient()

  const [user,      setUser]      = useState<AdminUser | null>(null)
  const [session,   setSession]   = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // ── On mount: restore existing session ───────────────────────────────────

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const { data: { session: s } } = await supabase.auth.getSession()
        if (cancelled) return

        if (s?.user) {
          const { data: profileRow } = await supabase
            .from('profiles')
            .select('is_active')
            .eq('id', s.user.id)
            .single()

          if (profileRow?.is_active === false) {
            await safeSignOutGlobal(supabase)
            if (!cancelled) setIsLoading(false)
            return
          }

          const adminUser = await fetchProfile(supabase, s.user)
          if (cancelled) return

          if (adminUser) {
            await setAdminActive(s.user.id)
            setCurrentLogger(adminUser.role, adminUser.id)
            setUser(adminUser)
            setSession(s)
          }
        }
      } catch {
        // Network failure — proceed to login page
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void init()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resolve email from role via DB RPC ────────────────────────────────────

  const resolveEmailByRole = useCallback(async (role: string): Promise<string | null> => {
    const { data, error } = await supabase.rpc('get_email_by_role', { p_role: role })
    if (error || !data) return null
    return data as string
  }, [supabase])

  // ── Login ─────────────────────────────────────────────────────────────────

  const loginPassword = useCallback(async (role: string, password: string) => {
    const email = await resolveEmailByRole(role)
    if (!email) return { error: 'Account not found. Please check your role selection.' }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error)      return { error: error.message }
    if (!data.user) return { error: 'No user returned.' }

    const adminUser = await fetchProfile(supabase, data.user)
    if (!adminUser) return { error: 'Account profile not found. Contact your administrator.' }

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', data.user.id)
      .single()

    if (profileRow?.is_active === false) {
      await safeSignOutGlobal(supabase)
      return { error: 'Your account has been disabled. Contact your administrator.' }
    }

    try {
      await registerSession(adminUser.role, adminUser.id)
    } catch {
      await safeSignOutGlobal(supabase)
      return { error: 'Could not establish a session lock. Please try again.' }
    }

    await setAdminActive(data.user.id)
    setCurrentLogger(adminUser.role, adminUser.id)
    await logLogin(adminUser.role)

    setUser(adminUser)
    setSession(data.session)

    return { error: null }
  }, [supabase, resolveEmailByRole]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Logout ────────────────────────────────────────────────────────────────

  const logout = useCallback(async () => {
    const roleForLog   = user?.role ?? null
    const userIdForLog = user?.id   ?? null

    if (roleForLog) {
      try {
        await import('./adminLogger').then(({ logAction }) =>
          logAction('logout', `${roleForLog} logged out`)
        )
      } catch { /* never block logout on log failure */ }
    }

    if (roleForLog) {
      try { await clearSession(roleForLog) } catch { /* never block logout */ }
    }

    if (userIdForLog) {
      try { await setAdminInactive(userIdForLog) } catch { /* never block logout */ }
    }

    setCurrentLogger(null)
    setUser(null)
    setSession(null)
    await supabase.auth.signOut({ scope: 'global' })
    window.location.href = '/login'
  }, [supabase, user])

  // ── Change password ───────────────────────────────────────────────────────

  const changePassword = useCallback(async (current: string, next: string) => {
    if (!user?.email) return { error: 'Session error. Please log out and back in.' }

    const { error: reAuthError } = await supabase.auth.signInWithPassword({
      email: user.email, password: current,
    })
    if (reAuthError) return { error: 'Current password is incorrect.' }

    const { error: updateError } = await supabase.auth.updateUser({ password: next })
    if (updateError) return { error: updateError.message }

    return { error: null }
  }, [supabase, user])

  // ── Send OTP ──────────────────────────────────────────────────────────────

  const sendPasswordResetOTP = useCallback(async (role: string) => {
    const email = await resolveEmailByRole(role)
    if (!email) {
      return { maskedEmail: null, error: 'Could not send code. Please check your role selection and try again.' }
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })

    if (error) {
      return { maskedEmail: null, error: 'Could not send code. Please check your role selection and try again.' }
    }

    return { maskedEmail: maskEmail(email), error: null }
  }, [supabase, resolveEmailByRole])

  // ── Verify OTP + reset password ───────────────────────────────────────────

  const verifyOTPAndReset = useCallback(async (
    role: string,
    token: string,
    newPassword: string,
  ) => {
    const email = await resolveEmailByRole(role)
    if (!email) return { error: 'Could not verify identity. Please restart the reset flow.' }

    const { error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (verifyError) return { error: 'Invalid or expired code. Please request a new one.' }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    if (updateError) return { error: updateError.message }

    await supabase.auth.signOut()
    return { error: null }
  }, [supabase, resolveEmailByRole])

  return (
    <AuthContext.Provider value={{
      user, session, isLoading,
      loginPassword, logout, changePassword,
      sendPasswordResetOTP, verifyOTPAndReset,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function canUserViewDocument(user: AdminUser, visibleToRoles: AdminRole[]): boolean {
  if (user.permissions.canViewAll) return true
  return visibleToRoles.includes(user.role)
}

export function isAdminRole(user: AdminUser | null): boolean {
  return user !== null && user.role === 'admin'
}