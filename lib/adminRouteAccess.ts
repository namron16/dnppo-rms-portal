// lib/adminRouteAccess.ts
// Dynamic role access. Standard 'documents' roles get DOC_ROUTES automatically.
// Special roles (admin, DPDA) keep their hardcoded routes.
// New roles created via the dashboard get documents access by default.

export type SessionRole = string   // No longer a fixed union — any role string is valid

const PUBLIC_ROUTES = ['/privacy-policy', '/terms-and-condition'] as const

const DOC_ROUTES = [
  '/admin/master', '/admin/admin-orders', '/admin/personnel',
  '/admin/daily-journals', '/admin/organization', '/admin/e-library',
  '/admin/forwarded', '/admin/archive',
] as const

const VIEWER_DOC_ROUTES = [
  '/admin/master', '/admin/admin-orders', '/admin/daily-journals',
  '/admin/organization', '/admin/e-library', '/admin/forwarded', '/admin/archive',
] as const

const P2_DOC_ROUTES = [
  '/admin/master', '/admin/admin-orders', '/admin/classified-documents',
  '/admin/organization', '/admin/e-library', '/admin/forwarded', '/admin/archive',
] as const

const ADMIN_ROUTES = [
  '/admin/log-history', '/admin/user-management',
  '/admin/gdrive', '/admin/backup-recovery',
] as const

const DPDA_ROUTES   = ['/admin/inbox'] as const

// Roles that use the full docs nav (includes 201 files)
const FULL_DOC_ROLES = ['P1', 'PD'] as const
// Roles with their own special nav
const SPECIAL_CASES  = ['admin', 'DPDA', 'DPDO', 'P2'] as const

export function getDefaultAdminRoute(role: SessionRole): string {
  if (role === 'admin')               return '/admin/log-history'
  if (role === 'DPDA' || role === 'DPDO') return '/admin/inbox'
  return '/admin/master'
}

export function getAllowedAdminRoutes(role: SessionRole): string[] {
  if (role === 'admin')               return [...ADMIN_ROUTES]
  if (role === 'DPDA' || role === 'DPDO') return [...DPDA_ROUTES, ...VIEWER_DOC_ROUTES]
  if (role === 'P2')                  return [...P2_DOC_ROUTES]
  if ((FULL_DOC_ROLES as readonly string[]).includes(role)) return [...DOC_ROUTES]
  // Default: all other roles (P3–P10, WCPD, PPSMU, and ANY new role) get viewer doc routes
  return [...VIEWER_DOC_ROUTES]
}

export function isAllowedAdminPath(pathname: string, role: SessionRole): boolean {
  if (pathname === '/admin') return true
  if (PUBLIC_ROUTES.some(r => pathname === r)) return true
  const routes = getAllowedAdminRoutes(role)
  return routes.some(r => pathname === r || pathname.startsWith(`${r}/`))
}