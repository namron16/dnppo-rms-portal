// proxy.ts (middleware entry point)
//
// FIX: now reads `nav_group` and `is_viewer_only` from user_metadata (JWT),
// so route access works for any dynamically created role without a DB call.
//
// When a new account is created via createAccount() in actions.ts, those
// fields are written into user_metadata. The JWT carries them on every request,
// so the middleware can enforce the correct routes instantly.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'
import {
  getDefaultAdminRoute,
  isAllowedAdminPath,
  type RoleInfo,
} from './lib/adminRouteAccess'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const { supabaseResponse, user } = await updateSession(request)

  const isLoggedIn = !!user

  // ── Read role info from JWT user_metadata ─────────────────────────────────
  // user_metadata is embedded in the JWT — no extra DB round-trip needed.
  // nav_group and is_viewer_only are written at account creation (actions.ts)
  // and also synced into user_metadata via register_role / createAccount.
  const meta = user?.user_metadata ?? {}

  const role: string | undefined =
    meta.role ?? user?.app_metadata?.role

  // Build a RoleInfo object so the route helpers can use nav_group.
  // Fall back gracefully if metadata is missing (e.g. old accounts).
  const roleInfo: RoleInfo | undefined = role
    ? {
        role,
        nav_group:     meta.nav_group     ?? inferNavGroup(role),
        is_viewer_only: meta.is_viewer_only ?? true,
      }
    : undefined

  function redirectTo(path: string) {
    const url = new URL(path, request.url)
    return NextResponse.redirect(url, { status: 303 })
  }

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
        secure:   process.env.NODE_ENV === 'production',
      })
    })

    return response
  }

  // ── Root ──────────────────────────────────────────────────────────────────
  if (pathname === '/') {
    return isLoggedIn && roleInfo
      ? redirectTo(getDefaultAdminRoute(roleInfo))
      : redirectTo('/login')
  }

  // ── Login page ────────────────────────────────────────────────────────────
  if (pathname.startsWith('/login')) {
    if (isLoggedIn && roleInfo) {
      const isActive = meta.is_active ?? true
      if (!isActive) return supabaseResponse
      return redirectTo(getDefaultAdminRoute(roleInfo))
    }
    return supabaseResponse
  }

  // ── Admin routes ──────────────────────────────────────────────────────────
  if (pathname.startsWith('/admin')) {
    if (!isLoggedIn || !roleInfo) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl, { status: 303 })
    }

    const isActive = meta.is_active ?? true
    if (!isActive) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('reason', 'account_disabled')
      return redirectAndClearSession(loginUrl.pathname + loginUrl.search)
    }

    if (pathname === '/admin') {
      return redirectTo(getDefaultAdminRoute(roleInfo))
    }

    if (!isAllowedAdminPath(pathname, roleInfo)) {
      return redirectTo(getDefaultAdminRoute(roleInfo))
    }

    return supabaseResponse
  }

  return supabaseResponse
}

// ── Fallback: infer nav_group from legacy hardcoded role names ────────────────
// Only used if nav_group is missing from user_metadata (accounts created before
// this fix). New accounts always have nav_group in user_metadata.
function inferNavGroup(role: string): string {
  if (role === 'admin')               return 'admin'
  if (role === 'DPDA' || role === 'DPDO') return 'dpda-dpdo'
  return 'documents'
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}