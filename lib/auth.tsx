'use client'
// lib/auth.tsx

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { createClient } from './supabase/client'
import { setCurrentLogger, logLogin } from './adminLogger'
import { clearSession, registerSession } from './sessionLock'
import { setAdminActive, setAdminInactive } from './accessRequests'
import type { Session, User } from '@supabase/supabase-js'

export type AdminRole =
  | 'admin' | 'PD' | 'DPDA' | 'DPDO'
  | 'P1' | 'P2' | 'P3' | 'P4' | 'P5'
  | 'P6' | 'P7' | 'P8' | 'P9' | 'P10' | 'PPSMU' | 'WCPD'

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
// Turns "pd@dnppo.gov.ph" into "p****@dnppo.gov.ph" so the UI can confirm
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
  loginPassword:  (role: string, password: string) => Promise<{ error: string | null }>
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
            await setAdminActive(s.user.id)

            // Set logger FIRST so any log fired during initial render already
            // has a valid logger context.
            setCurrentLogger(adminUser.role, adminUser.id)
            setUser(adminUser)
            setSession(s)
          } else {
            if (process.env.NODE_ENV === 'development') {
              console.warn(
                '[auth] Session restored but profile fetch returned null. ' +
                'setCurrentLogger() was NOT called — log calls will be dropped until re-login.'
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

      // ── Resolve email from role via DB RPC ────────────────────────────────────
  // ISSUE 2 FIX: memoized with useCallback so it's stable across renders and
  // can be safely listed as a dependency in sendPasswordResetOTP and
  // verifyOTPAndReset without causing infinite re-creation loops.
  //
  // This is the ONLY place in the codebase that knows role → email.
  // The raw email never reaches the UI — only the masked form is returned
  // to callers via sendPasswordResetOTP.
  //
  // Requires this function in your Supabase SQL editor (run once):
  //
  //   create or replace function get_email_by_role(p_role text)
  //   returns text
  //   language sql
  //   security definer
  //   as $$
  //     select u.email
  //     from auth.users u
  //     join profiles p on p.id = u.id
  //     where p.role = p_role
  //     limit 1;
  //   $$;

    const resolveEmailByRole = useCallback(async (role: string): Promise<string | null> => {
    const { data, error } = await supabase.rpc('get_email_by_role', { p_role: role })
    if (error || !data) return null
    return data as string
  }, [supabase])

  // ── Login ─────────────────────────────────────────────────────────────────
  const loginPassword = useCallback(async (role: string, password: string) => {
    const email = await resolveEmailByRole(role)
    if (!email) {
      return { error: 'Account not found. Please check your role selection.' }
    }
    // Step 2 — sign in with resolved email + password
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
      await supabase.auth.signOut()
      return { error: 'Your account has been disabled. Contact your administrator.' }
    }

    try {
      await registerSession(adminUser.role, adminUser.id)
    } catch {
      await supabase.auth.signOut()
      return { error: 'Could not establish a session lock. Please try again.' }
    }

    await setAdminActive(data.user.id)

    // Logger must be ready BEFORE logLogin fires — preserve this order.
    setCurrentLogger(adminUser.role, adminUser.id)
    await logLogin(adminUser.role)

    setUser(adminUser)
    setSession(data.session)

    return { error: null }
  }, [supabase, resolveEmailByRole]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Logout ────────────────────────────────────────────────────────────────

  const logout = useCallback(async () => {
    // Capture role and userId before clearing state so the logout log can still fire.
    const roleForLog = user?.role ?? null
    const userIdForLog = user?.id ?? null

    if (roleForLog) {
      try {
        await import('./adminLogger').then(({ logAction }) =>
          logAction('logout', `${roleForLog} logged out`)
        )
      } catch {
        // Never block logout on a log failure
      }
    }

    if (roleForLog) {
      try {
        await clearSession(roleForLog)
      } catch {
        // Never block logout on a lock cleanup failure
      }
    }

    if (userIdForLog) {
      try {
        await setAdminInactive(userIdForLog)
      } catch {
        // Never block logout on presence cleanup failure
      }
    }

    setCurrentLogger(null)
    setUser(null)
    setSession(null)
    await supabase.auth.signOut()
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




  // ── Send OTP for password reset (logged-out flow) ─────────────────────────
  // Accepts a role string. Resolves email internally — caller never receives
  // the raw address, only a masked hint (e.g. "p****@dnppo.gov.ph").
  // shouldCreateUser: false ensures only existing accounts trigger OTPs.

  const sendPasswordResetOTP = useCallback(async (role: string) => {
    const email = await resolveEmailByRole(role)

    // Return the same vague error whether the role has no match or Supabase
    // rejects — prevents account enumeration via error message differences.
    if (!email) {
      return {
        maskedEmail: null,
        error: 'Could not send code. Please check your role selection and try again.',
      }
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })

    if (error) {
      return {
        maskedEmail: null,
        error: 'Could not send code. Please check your role selection and try again.',
      }
    }

    // Return only the masked form — UI shows "sent to p****@dnppo.gov.ph"
    return { maskedEmail: maskEmail(email), error: null }
  }, [supabase, resolveEmailByRole])

  // ── Verify OTP and set new password (logged-out flow) ────────────────────
  // 1. resolveEmailByRole — get the raw email for Supabase (never sent to UI)
  // 2. verifyOtp          — authenticate the session with the 6-digit code
  // 3. updateUser         — set the new password on the now-authenticated session
  // 4. signOut            — clear the session; user must log in fresh with new pw
  //
  // NOTE: verifyOtp type 'email' is correct for supabase-js v2 numeric OTP.
  // If using an older version, change to 'magiclink'. Confirm in Supabase
  // dashboard: Auth → Email → ensure "Enable OTP" is ON (not just magic link).

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

    // Sign out immediately — no unintended session should linger on the login page.
    await supabase.auth.signOut()

    return { error: null }
  }, [supabase, resolveEmailByRole])

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