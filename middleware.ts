// middleware.ts — JWT-validated route protection via Supabase SSR

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import { getDefaultAdminRoute, isAllowedAdminPath } from './lib/adminRouteAccess'
import type { SessionRole } from './lib/adminRouteAccess'
import { supabase } from './lib/supabase'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // updateSession refreshes the JWT and returns the validated user (or null)
  const { supabaseResponse, user } = await updateSession(request)

  const isLoggedIn = !!user
  const role = user?.user_metadata?.role as SessionRole | undefined

  // ── Helper ───────────────────────────────

  function redirectTo(path: string) {
    const url = new URL(path, request.url)
    return NextResponse.redirect(url)
  }

  // ── Root redirect ─────────────────────────

  if (pathname === '/') {
    return isLoggedIn && role
      ? redirectTo(getDefaultAdminRoute(role))
      : redirectTo('/login')
  }

  // ── /login ────────────────────────────────

  if (pathname.startsWith('/login')) {
    if (isLoggedIn && role) {
      return redirectTo(getDefaultAdminRoute(role))
    }
    return supabaseResponse   // allow
  }

  // ── /admin/* ──────────────────────────────

  if (pathname.startsWith('/admin')) {
    
    if (!isLoggedIn || !role) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
    }


    const { data: profile } = await supabase
    .from('profiles')
    .select('is_active')
    .eq('id', user!.id)    // user is non-null here since isLoggedIn is true
    .single()

  if (!profile?.is_active) {
    // Sign the user out and redirect to login with a reason
    await supabase.auth.signOut()
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('reason', 'account_disabled')
    return NextResponse.redirect(loginUrl)
  }

    // Redirect /admin → role's default page
    if (pathname === '/admin') {
      return redirectTo(getDefaultAdminRoute(role))
    }

    // Block unauthorized paths
    if (!isAllowedAdminPath(pathname, role)) {
      return redirectTo(getDefaultAdminRoute(role))
    }

    return supabaseResponse   // allow
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}