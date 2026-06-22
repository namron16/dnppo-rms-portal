'use client'
// components/layout/AuthGuard.tsx

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { isAllowedAdminPath, getDefaultAdminRoute } from '@/lib/adminRouteAccess'
import type { RoleInfo } from '@/lib/adminRouteAccess'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { clearLocalToken, checkSessionStatus } from '@/lib/sessionLock'
import { createClient } from '@/lib/supabase/client'

interface AuthGuardProps {
  requiredRole?: 'admin' | 'officer' | 'any'
  children: React.ReactNode
}

const LOADING_TIMEOUT_MS             = 8_000
const SESSION_CHECK_INTERVAL_MS      = 30_000
const INITIAL_SESSION_CHECK_DELAY_MS = 3_000

export function AuthGuard({ requiredRole = 'any', children }: AuthGuardProps) {
  const { user, isLoading } = useAuth()
  const router   = useRouter()
  const pathname = usePathname()
  const [timedOut, setTimedOut] = useState(false)
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Timeout safety net ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoading) {
      if (timerRef.current) clearTimeout(timerRef.current)
      setTimedOut(false)
      return
    }
    timerRef.current = setTimeout(() => setTimedOut(true), LOADING_TIMEOUT_MS)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [isLoading])

  // ── Session lock + expiry polling ─────────────────────────────────────────
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (isLoading || !user) return

    let cancelled = false

    const checkSession = async () => {
      if (cancelled) return

      const status = await checkSessionStatus(user.role)
      if (cancelled) return

      if (status === 'valid') return

      clearLocalToken()
      await createClient().auth.signOut({ scope: 'local' })

      if (cancelled) return

      if (status === 'expired') {
        router.replace('/login?reason=session_expired')
      } else if (status === 'taken') {
        router.replace('/login?reason=session_taken')
      } else {
        router.replace('/login')
      }
    }

    const delayRef = setTimeout(() => {
      void checkSession()
      intervalRef.current = setInterval(() => {
        void checkSession()
      }, SESSION_CHECK_INTERVAL_MS)
    }, INITIAL_SESSION_CHECK_DELAY_MS)

    return () => {
      cancelled = true
      clearTimeout(delayRef)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isLoading, router, user])

  // ── Route guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading && !timedOut) return
    if (!user) {
      router.replace('/login')
      return
    }

    // FIX: build a RoleInfo object from the user so the route checker uses
    // nav_group instead of matching on the hardcoded role name string.
    // Without this, dynamically created roles (e.g. 'TESTACCOUNT') are not
    // recognized and the guard redirects in a loop → infinite loading spinner.
    const roleInfo: RoleInfo = {
      role:           user.role,
      nav_group:      user.nav_group,
      is_viewer_only: user.is_viewer_only,
    }

    if (pathname && !isAllowedAdminPath(pathname, roleInfo)) {
      router.replace(getDefaultAdminRoute(roleInfo))
    }
  }, [user, isLoading, timedOut, router, pathname])

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLoading && !timedOut)  return <LoadingSpinner fullPage />
  if (timedOut && !user)       return <LoadingSpinner fullPage />
  if (!user)                   return <LoadingSpinner fullPage />

  // FIX: same RoleInfo check here — don't block render for valid routes
  const roleInfo: RoleInfo = {
    role:           user.role,
    nav_group:      user.nav_group,
    is_viewer_only: user.is_viewer_only,
  }
  if (pathname && !isAllowedAdminPath(pathname, roleInfo)) return <LoadingSpinner fullPage />

  return <>{children}</>
}