import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import { getDefaultAdminRoute, isAllowedAdminPath } from './lib/adminRouteAccess'
import type { SessionRole } from './lib/adminRouteAccess'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const { supabaseResponse, user } = await updateSession(request)

  const isLoggedIn = !!user
  // Role is stored in user_metadata by Supabase when the profile is created.
  // Fall back to app_metadata for service-role inserts.
  const role = (
    user?.user_metadata?.role ?? user?.app_metadata?.role
  ) as SessionRole | undefined

  function redirectTo(path: string) {
    const url = new URL(path, request.url)
    // 303 See Other — tells the browser to GET the new URL and
    // replace the current history entry, so Back won't return here.
    return NextResponse.redirect(url, { status: 303 })
  }

  // ── Helper: build a redirect that nukes ALL session cookies ───────────────
  // We collect cookie names from both the incoming request (what the browser
  // sent) AND from supabaseResponse (what Supabase may have set/refreshed
  // during updateSession). This ensures no stale token survives the redirect
  // and prevents the "Failed to fetch RSC payload" error caused by the
  // middleware letting a half-cleared session through to /admin/* routes.
  function redirectAndClearSession(path: string) {
    const url = new URL(path, request.url)
    const response = NextResponse.redirect(url, { status: 303 })

    const namesToClear = new Set<string>([
      ...request.cookies.getAll().map(c => c.name),
      ...supabaseResponse.cookies.getAll().map(c => c.name),
    ])

    namesToClear.forEach(name => {
      response.cookies.set(name, '', {
        maxAge:   0,
        path:     '/',
        httpOnly: true,
        sameSite: 'lax',
        // Mirror the secure flag used in lib/supabase/middleware.ts
        secure:   process.env.NODE_ENV === 'production',
      })
    })

    return response
  }

  // ── Root ────────────────────────────────────
  if (pathname === '/') {
    return isLoggedIn && role
      ? redirectTo(getDefaultAdminRoute(role))
      : redirectTo('/login')
  }

  // ── Login page ──────────────────────────────
  if (pathname.startsWith('/login')) {
    if (isLoggedIn && role) {
      // If the account is disabled, don't redirect to admin — let the login
      // page handle the ?disabled=1 message instead.
      const isActive = user?.user_metadata?.is_active ?? true
      if (!isActive) {
        return supabaseResponse
      }
      return redirectTo(getDefaultAdminRoute(role))
    }
    return supabaseResponse
  }

  // ── Admin routes ────────────────────────────
  if (pathname.startsWith('/admin')) {
    // Not authenticated
    if (!isLoggedIn || !role) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl, { status: 303 })
    }

    // Account disabled check (reads from JWT user_metadata — no DB call needed)
    // Redirect to /login?disabled=1 and nuke all session cookies so the browser
    // cannot replay the old session on the next request, which would cause the
    // middleware to grant access again before the client-side signOut resolves.
    const isActive = user?.user_metadata?.is_active ?? true
    if (!isActive) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('reason', 'account_disabled')
      return redirectAndClearSession(loginUrl.pathname + loginUrl.search)
    }

    if (pathname === '/admin') {
      return redirectTo(getDefaultAdminRoute(role))
    }

    if (!isAllowedAdminPath(pathname, role)) {
      return redirectTo(getDefaultAdminRoute(role))
    }

    return supabaseResponse
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}