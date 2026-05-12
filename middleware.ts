import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import { getDefaultAdminRoute, isAllowedAdminPath } from './lib/adminRouteAccess'
import type { SessionRole } from './lib/adminRouteAccess'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const { supabaseResponse, user } = await updateSession(request)

  const isLoggedIn = !!user
  const role = user?.user_metadata?.role as SessionRole | undefined

  function redirectTo(path: string) {
    const url = new URL(path, request.url)
    return NextResponse.redirect(url)
  }

  if (pathname === '/') {
    return isLoggedIn && role
      ? redirectTo(getDefaultAdminRoute(role))
      : redirectTo('/login')
  }

  if (pathname.startsWith('/login')) {
    if (isLoggedIn && role) {
      return redirectTo(getDefaultAdminRoute(role))
    }
    return supabaseResponse
  }

  if (pathname.startsWith('/admin')) {
    if (!isLoggedIn || !role) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
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