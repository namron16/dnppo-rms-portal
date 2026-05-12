'use client'
// lib/auth.tsx — Supabase Auth-backed RBAC
// No hardcoded accounts. All identity comes from Supabase Auth + profiles table.

import React, {
  createContext, useContext, useState,
  useCallback, useEffect,
} from 'react'
import { createClient } from './supabase/client'
import { setCurrentLogger } from './adminLogger'
import type { Session, User } from '@supabase/supabase-js'

// ── Role Definitions ──────────────────────────
export type AdminRole =
  | 'admin' | 'PD' | 'DPDA' | 'DPDO'
  | 'P1' | 'P2' | 'P3' | 'P4' | 'P5'
  | 'P6' | 'P7' | 'P8' | 'P9' | 'P10'

export type RoleLevel = 'head' | 'deputy' | 'super_admin' | 'viewer'

export interface AdminUser {
  id:           string        // Supabase auth UUID
  role:         AdminRole
  email:        string
  name:         string
  title:        string
  level:        RoleLevel
  initials:     string
  avatarColor:  string
  avatarUrl?:   string
  permissions: {
    canUpload:            boolean
    canApproveReview:     boolean
    canApproveFinal:      boolean
    canManageUsers:       boolean
    canManageVisibility:  boolean
    canViewAll:           boolean
  }
}

// ── Role → Permissions Map ────────────────────
// Derived from role, not stored per-account.

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
      // P2–P10
      return { canUpload: true, canApproveReview: false, canApproveFinal: true,
               canManageUsers: false, canManageVisibility: false, canViewAll: true }
  }
}

function levelForRole(role: AdminRole): RoleLevel {
  if (role === 'admin') return 'super_admin'
  if (role === 'DPDA' || role === 'DPDO') return 'deputy'
  if (role === 'PD' || role === 'P1') return 'head'
  return 'viewer'
}

// ── Build AdminUser from Supabase data ────────

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

// ── Auth Context ──────────────────────────────

export type OtpStep = 'email' | 'otp' | 'password' | 'done'

interface AuthContextValue {
  user:      AdminUser | null
  session:   Session | null
  isLoading: boolean
  loginPassword: (email: string, password: string) => Promise<{ error: string | null }>
  logout:        () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient()

  const [user,      setUser]      = useState<AdminUser | null>(null)
  const [session,   setSession]   = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // ── Load profile from DB ──────────────────

  async function loadProfile(authUser: User): Promise<AdminUser | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('role, display_name, title, initials, avatar_color, avatar_url')
      .eq('id', authUser.id)
      .single()

    if (error || !data) {
      console.error('loadProfile error:', error?.message)
      return null
    }

    return buildAdminUser(authUser, data as ProfileRow)
  }

  // ── Session Listener ──────────────────────

  useEffect(() => {
    // Initial session check
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (s?.user) {
        const adminUser = await loadProfile(s.user)
        setUser(adminUser)
        setSession(s)
        if (adminUser) setCurrentLogger(adminUser.role as AdminRole, adminUser.id)
      }
      setIsLoading(false)
    })

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        if (s?.user) {
          const adminUser = await loadProfile(s.user)
          setUser(adminUser)
          setSession(s)
          if (adminUser) setCurrentLogger(adminUser.role as AdminRole, adminUser.id)
        } else {
          setUser(null)
          setSession(null)
          setCurrentLogger(null)
        }
        setIsLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])



  // Password Login ────────────────

  const loginPassword = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) return { error: error.message }
    if (!data.user) return { error: 'No user returned.' }

    const adminUser = await loadProfile(data.user)
    if (!adminUser) return { error: 'Account profile not found. Contact your administrator.' }

    setUser(adminUser)
    setSession(data.session)
    setCurrentLogger(adminUser.role as AdminRole, adminUser.id)

    return { error: null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  // ── Logout ────────────────────────────────

  const logout = useCallback(async () => {
    setCurrentLogger(null)
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
  }, [supabase])

  // change password
  
  const changePassword = useCallback(async (
    currentPassword: string,
    newPassword: string,
  ): Promise<{ error: string | null }> => {

    // user is guaranteed non-null here because the modal
    // only renders when the user is authenticated.
    if (!user?.email) {
      return { error: 'Session error. Please log out and log back in.' }
    }

    // ── Step A: Re-authenticate with the current password ──
    // This is the critical security step. Without it, anyone who
    // walks up to an unlocked screen could change the password.
    const { error: reAuthError } = await supabase.auth.signInWithPassword({
      email:    user.email,
      password: currentPassword,
    })

    if (reAuthError) {
      // Return a generic message — don't leak Supabase internals
      return { error: 'Current password is incorrect.' }
    }

  // ── Step B: Set the new password ──
  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  })

  if (updateError) {
    return { error: updateError.message }
  }

  return { error: null }
}, [supabase, user])

  return (
    <AuthContext.Provider value={{
      user, session, isLoading, loginPassword, logout, changePassword,
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
  return user !== null
}