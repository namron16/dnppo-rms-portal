'use client'
// lib/auth.tsx

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { createClient } from './supabase/client'
import { setCurrentLogger, logLogin } from './adminLogger'
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

async function fetchProfile(supabase: ReturnType<typeof createClient>, user: User): Promise<AdminUser | null> {
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

// ── Context ───────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user:                  AdminUser | null
  session:               Session | null
  isLoading:             boolean
  loginPassword:         (email: string, password: string) => Promise<{ error: string | null }>
  logout:                () => Promise<void>
  changePassword:        (current: string, next: string)   => Promise<{ error: string | null }>
  // ── OTP password reset (for logged-out users on the login page) ───────────
  sendPasswordResetOTP:  (email: string) => Promise<{ error: string | null }>
  verifyOTPAndReset:     (email: string, token: string, newPassword: string) => Promise<{ error: string | null }>
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
          setUser(adminUser)
          setSession(s)
          if (adminUser) setCurrentLogger(adminUser.role, adminUser.id)
        }
      } catch {
        // Network failure — not logged in, proceed to login page
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void init()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Login ─────────────────────────────────────────────────────────────────

  const loginPassword = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)

    if (error)      return { error: error.message }
    if (!data.user) return { error: 'No user returned.' }

    const adminUser = await fetchProfile(supabase, data.user)
    if (!adminUser) return { error: 'Account profile not found. Contact your administrator.' }

    setUser(adminUser)
    setSession(data.session)
    setCurrentLogger(adminUser.role, adminUser.id)
    await logLogin(adminUser.role)

    return { error: null }
  }, [supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Logout ────────────────────────────────────────────────────────────────

  const logout = useCallback(async () => {
    setCurrentLogger(null)
    setUser(null)
    setSession(null)
    await supabase.auth.signOut()
    window.location.href = '/login'
  }, [supabase])

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
  // Uses Supabase's signInWithOtp which sends a 6-digit code via email.
  // shouldCreateUser: false ensures only existing accounts can trigger this.

  const sendPasswordResetOTP = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false, // never create a new account via OTP
      },
    })

    // Supabase returns a generic error if the email doesn't exist when
    // shouldCreateUser is false — surface a safe, non-enumerable message.
    if (error) {
      // Don't reveal whether the email exists or not — always show the same message
      return { error: 'Could not send code. Please check your role selection and try again.' }
    }

    return { error: null }
  }, [supabase])

  // ── Verify OTP and set new password (logged-out flow) ────────────────────
  // Step 1: verifyOtp authenticates the user with the 6-digit code.
  // Step 2: updateUser sets the new password on the now-authenticated session.
  // The user is left signed in — we then sign them back out so they log in
  // normally with the new password (clean UX, no accidental session bleed).

  const verifyOTPAndReset = useCallback(async (
    email: string,
    token: string,
    newPassword: string,
  ) => {
    // Verify the OTP — this establishes a session
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })

    if (verifyError) {
      return { error: 'Invalid or expired code. Please request a new one.' }
    }

    // Set the new password
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (updateError) {
      return { error: updateError.message }
    }

    // Sign out immediately — user should log in fresh with their new password.
    // This prevents an unintended session from persisting on the login page.
    await supabase.auth.signOut()

    return { error: null }
  }, [supabase])

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