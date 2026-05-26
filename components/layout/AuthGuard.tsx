'use client'
// components/layout/AuthGuard.tsx

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { isAllowedAdminPath } from '@/lib/adminRouteAccess'
import type { SessionRole } from '@/lib/adminRouteAccess'
import { getDefaultAdminRoute } from '@/lib/adminRouteAccess'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { clearLocalToken, isSessionValid } from '@/lib/sessionLock'
import { createClient } from '@/lib/supabase/client'

interface AuthGuardProps {
  requiredRole?: 'admin' | 'officer' | 'any'
  children: React.ReactNode
}

const LOADING_TIMEOUT_MS        = 8_000
const SESSION_CHECK_INTERVAL_MS = 30_000
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

  // ── Session lock polling ───────────────────────────────────────────────────
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (isLoading || !user) return

    let cancelled = false

    const checkSessionLock = async () => {
      if (cancelled) return
      const valid = await isSessionValid(user.role)
      if (cancelled || valid) return

      // ── CRITICAL FIX ──────────────────────────────────────────────────────
      // Use scope:'local' so we only clear THIS browser's Supabase session.
      // The default (scope:'global') revokes the token server-side, which
      // invalidates the JWT for ALL browsers logged in as this user — causing
      // Browser 2 to also get logged out when it was the one that should stay.
      clearLocalToken()
      await createClient().auth.signOut({ scope: 'local' })
      router.replace('/login?reason=session_taken')
    }

    const delayRef = setTimeout(() => {
      void checkSessionLock()
      intervalRef.current = setInterval(() => {
        void checkSessionLock()
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
  if (isLoading && !timedOut)                                        return <LoadingSpinner fullPage />
  if (timedOut && !user)                                             return <LoadingSpinner fullPage />
  if (!user)                                                         return <LoadingSpinner fullPage />
  if (pathname && !isAllowedAdminPath(pathname, user.role as SessionRole)) return <LoadingSpinner fullPage />

  return <>{children}</>
}