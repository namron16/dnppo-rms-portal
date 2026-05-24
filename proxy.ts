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
    const response = NextResponse.redirect(url)
    // 303 See Other — tells the browser to GET the new URL and
    // replace the current history entry, so Back won't return here.
    response.headers.set('Location', url.toString())
    return NextResponse.redirect(url, { status: 303 })
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

  // ✅ NEW — account disabled check (reads from JWT, no DB call)
  const isActive = user?.user_metadata?.is_active ?? true
  if (!isActive) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('disabled', '1')
    const response = NextResponse.redirect(loginUrl, { status: 303 })
    // Clear session cookies so the browser doesn't replay the old session
    supabaseResponse.cookies.getAll().forEach(cookie => {
      response.cookies.set(cookie.name, '', { maxAge: 0 })
    })
    return response
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