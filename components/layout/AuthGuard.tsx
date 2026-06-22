'use client'
// components/layout/AuthGuard.tsx

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { isAllowedAdminPath } from '@/lib/adminRouteAccess'
import type { SessionRole } from '@/lib/adminRouteAccess'
import { getDefaultAdminRoute } from '@/lib/adminRouteAccess'
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
  // Runs every 30 seconds. Think of it like a security guard checking your
  // badge — if it's been stolen or expired, you get escorted out.
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

      if (status === 'valid') return  // all good, nothing to do

      // Clear the local token no matter why we're logging out
      clearLocalToken()

      // ── Scope: 'local' ────────────────────────────────────────────────────
      // We only clear THIS browser's Supabase session.
      // Using 'global' would revoke the JWT server-side and log out ALL
      // browsers, which is wrong for the 'taken' case (Browser 2 should stay).
      await createClient().auth.signOut({ scope: 'local' })

      if (cancelled) return

      if (status === 'expired') {
        // Session timed out — tell the login page to show an expiry message
        router.replace('/login?reason=session_expired')
      } else if (status === 'taken') {
        // Another browser logged in with the same role
        router.replace('/login?reason=session_taken')
      } else {
        // 'invalid' — no token or DB row; just send back to login
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

    if (pathname && !isAllowedAdminPath(pathname, user.role as SessionRole)) {
      router.replace(getDefaultAdminRoute(user.role as SessionRole))
    }
  }, [user, isLoading, timedOut, router, pathname])

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLoading && !timedOut)                                                return <LoadingSpinner fullPage />
  if (timedOut && !user)                                                     return <LoadingSpinner fullPage />
  if (!user)                                                                 return <LoadingSpinner fullPage />
  if (pathname && !isAllowedAdminPath(pathname, user.role as SessionRole))   return <LoadingSpinner fullPage />

  return <>{children}</>
}