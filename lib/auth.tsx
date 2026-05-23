'use client'
// lib/auth.tsx

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { createClient } from './supabase/client'
import { setCurrentLogger, logLogin, isLoggerReady } from './adminLogger'
import type { Session, User } from '@supabase/supabase-js'

export type AdminRole =
  | 'admin' | 'PD' | 'DPDA' | 'DPDO'
  | 'P1' | 'P2' | 'P3' | 'P4' | 'P5'
  | 'P6' | 'P7' | 'P8' | 'P9' | 'P10'

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
    case 'DPDA':
    case 'DPDO':
      return { canUpload: false, canApproveReview: true, canApproveFinal: false,
               canManageUsers: false, canManageVisibility: false, canViewAll: true }
    case 'P1':
      return { canUpload: true, canApproveReview: false, canApproveFinal: false,
               canManageUsers: true, canManageVisibility: true, canViewAll: true }
    default:
      return { canUpload: true, canApproveReview: false, canApproveFinal: true,
               canManageUsers: false, canManageVisibility: false, canViewAll: true }
  }
}

function levelForRole(role: AdminRole): RoleLevel {
  if (role === 'admin') return 'super_admin'
  if (role === 'DPDA' || role === 'DPDO') return 'deputy'
  return 'admin'
}

interface ProfileRow {
  role:         string
  display_name: string | null
  title:        string | null
  initials:     string | null
  avatar_color: string | null
  avatar_url:   string | null
}

function buildAdminUser(user: User, profile: ProfileRow): AdminUser {
  const role = profile.role as AdminRole
  return {
    id:          user.id,
    role,
    email:       user.email ?? '',
    name:        profile.display_name ?? role,
    title:       profile.title        ?? role,
    level:       levelForRole(role),
    initials:    profile.initials     ?? role.slice(0, 2).toUpperCase(),
    avatarColor: profile.avatar_color ?? '#6b7280',
    avatarUrl:   profile.avatar_url   ?? undefined,
    permissions: permissionsForRole(role),
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
    return buildAdminUser(user, data as ProfileRow)
  } catch {
    return null
  }
}

// ── Email masking helper ──────────────────────────────────────────────────────
// Turns "pd@dnppo.gov.ph" into "p*@dnppo.gov.ph" so the UI can confirm
// which address the code was sent to without exposing the full email.

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const visible = local.slice(0, 1)
  const masked  = local.length > 1 ? '*'.repeat(Math.min(local.length - 1, 4)) : ''
  return `${visible}${masked}@${domain}`
}

// ── Context ───────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user:           AdminUser | null
  session:        Session | null
  isLoading:      boolean
  loginPassword:  (email: string, password: string) => Promise<{ error: string | null }>
  logout:         () => Promise<void>
  changePassword: (current: string, next: string)   => Promise<{ error: string | null }>

  // ── OTP password reset (logged-out flow, login page only) ────────────────
  // Accepts a role string — resolves the email internally via DB RPC.
  // Returns the masked email on success so the UI can show a hint.
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
  // FIX RISK 1: setCurrentLogger is called before any component mounts and
  // can fire a log. The cancelled guard ensures we never set stale state
  // after unmount. A dev warning fires if the profile fetch fails but a
  // Supabase session exists — that means logs would be silently dropped.

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const { data: { session: s } } = await supabase.auth.getSession()
        if (cancelled) return

        if (s?.user) {
          const adminUser = await fetchProfile(supabase, s.user)
          if (cancelled) return

          if (adminUser) {
            // FIX RISK 1: set logger FIRST, before updating React state.
            // This ensures any log fired during the initial render cycle
            // (e.g. from a useEffect in a page) already has a valid logger.
            setCurrentLogger(adminUser.role, adminUser.id)
            setUser(adminUser)
            setSession(s)

            // Sanity-check in dev: confirm the logger is actually ready
            // immediately after setting it.
            if (process.env.NODE_ENV === 'development' && !isLoggerReady()) {
              console.warn(
                '[auth] setCurrentLogger() called but isLoggerReady() is still false. ' +
                'Check that role and userId are both non-null.'
              )
            }
          } else {
            // Session exists but profile fetch failed — logger stays null.
            // Warn in dev so this silent audit gap is caught early.
            if (process.env.NODE_ENV === 'development') {
              console.warn(
                '[auth] Session restored but profile fetch returned null. ' +
                'setCurrentLogger() was NOT called — all log calls will be dropped until the user logs in again.'
              )
            }
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

  // ── Login ─────────────────────────────────────────────────────────────────
  // FIX RISK 1: setCurrentLogger is called BEFORE logLogin so the logger
  // is guaranteed ready when logLogin fires. Previously the order was
  // correct but now it is explicit and documented.

  const loginPassword = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error)      return { error: error.message }
    if (!data.user) return { error: 'No user returned.' }

    const adminUser = await fetchProfile(supabase, data.user)
    if (!adminUser) return { error: 'Account profile not found. Contact your administrator.' }

    // FIX RISK 1: logger must be ready BEFORE logLogin — preserve this order.
    setCurrentLogger(adminUser.role, adminUser.id)

    // Confirm in dev that the logger is ready before writing the login log.
    if (process.env.NODE_ENV === 'development' && !isLoggerReady()) {
      console.warn('[auth] loginPassword: logger still not ready after setCurrentLogger() — login log will be dropped.')
    }

    await logLogin(adminUser.role)

    setUser(adminUser)
    setSession(data.session)

    return { error: null }
  }, [supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Logout ────────────────────────────────────────────────────────────────
  // FIX RISK 1: original code called setCurrentLogger(null) BEFORE signOut,
  // which meant the logout log (if added in future) would always be dropped.
  // Fixed order:
  //   1. Write the logout log (logger is still valid here)
  //   2. Clear logger state
  //   3. Clear React state
  //   4. Call signOut
  //   5. Redirect

  const logout = useCallback(async () => {
    // Step 1: capture role for the log before clearing anything
    const roleForLog = user?.role ?? null

    // Step 2: write logout log while logger is still valid
    if (roleForLog) {
      try {
        // logAction is fire-and-forget; await so it completes before signOut
        // invalidates the session (which would break the Supabase insert).
        await import('./adminLogger').then(({ logAction }) =>
          logAction('logout', `${roleForLog} logged out`)
        )
      } catch {
        // Never block logout on a log failure
      }
    }

    // Step 3: now clear the logger and React state
    setCurrentLogger(null)
    setUser(null)
    setSession(null)

    // Step 4: invalidate the Supabase session
    await supabase.auth.signOut()

    // Step 5: redirect
    window.location.href = '/login'
  }, [supabase, user])

  // ── Change password (logged-in flow — requires current password) ──────────

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

  // ── Resolve email from role via DB RPC ────────────────────────────────────
  // This is the only place in the codebase that knows role → email.
  // The frontend never stores or displays the raw email.

  async function resolveEmailByRole(role: string): Promise<string | null> {
    const { data, error } = await supabase.rpc('get_email_by_role', { p_role: role })
    if (error || !data) return null
    return data as string
  }

  // ── Send OTP for password reset (logged-out flow) ─────────────────────────

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
  }, [supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Verify OTP and set new password (logged-out flow) ────────────────────

  const verifyOTPAndReset = useCallback(async (
    role: string,
    token: string,
    newPassword: string,
  ) => {
    const email = await resolveEmailByRole(role)
    if (!email) {
      return { error: 'Could not verify identity. Please restart the reset flow.' }
    }

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })
    if (verifyError) {
      return { error: 'Invalid or expired code. Please request a new one.' }
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    if (updateError) {
      return { error: updateError.message }
    }

    // Sign out immediately so no unintended session lingers on the login page
    await supabase.auth.signOut()

    return { error: null }
  }, [supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider value={{
      user,
      session,
      isLoading,
      loginPassword,
      logout,
      changePassword,
      sendPasswordResetOTP,
      verifyOTPAndReset,
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