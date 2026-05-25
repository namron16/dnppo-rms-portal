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

const LOADING_TIMEOUT_MS      = 8_000
const SESSION_CHECK_INTERVAL_MS = 30_000
// Delay before the VERY FIRST session check after login/refresh.
// This gives registerSession() time to finish writing the new token to the DB
// before we read it back — preventing a false "session taken" logout on Browser 2
// immediately after it kicks out Browser 1.
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

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [isLoading])

  // ── Session lock polling ───────────────────────────────────────────────────
  useEffect(() => {
    // Clear any previous interval whenever user/loading state changes
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // Don't start polling until auth is fully resolved AND we have a user.
    // This is the critical guard — it prevents the check from firing during
    // the login transition or before the session token is written to the DB.
    if (isLoading || !user) return

    let cancelled = false

    const checkSessionLock = async () => {
      if (cancelled) return
      const valid = await isSessionValid(user.role)
      if (cancelled || valid) return

      clearLocalToken()
      await createClient().auth.signOut()
      router.replace('/login?reason=session_taken')
    }

    // Delay the FIRST check so the DB write from registerSession() has time
    // to propagate before we read it back. Without this delay, Browser 2 can
    // call isSessionValid() before its own token is committed, see a mismatch,
    // and immediately log itself out after kicking Browser 1.
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

    void (async () => {
      // NOTE: Do NOT call isSessionValid() here — the polling effect above
      // already owns session validation. Calling it here too creates a race:
      // both effects run concurrently on mount, and if one clears the token
      // before the other reads it, Browser 2 gets falsely logged out.
      //
      // This effect only handles route access control.
      if (pathname && !isAllowedAdminPath(pathname, user.role as SessionRole)) {
        router.replace(getDefaultAdminRoute(user.role as SessionRole))
      }
    })()
  }, [user, isLoading, timedOut, router, pathname])

  // ── Render logic ───────────────────────────────────────────────────────────

  if (isLoading && !timedOut) {
    return <LoadingSpinner fullPage />
  }

  if (timedOut && user) {
    // Fall through to render children below
  }

  if (timedOut && !user) {
    return <LoadingSpinner fullPage />
  }

  if (!user) {
    return <LoadingSpinner fullPage />
  }

  if (pathname && !isAllowedAdminPath(pathname, user.role as SessionRole)) {
    return <LoadingSpinner fullPage />
  }

  return <>{children}</>
}