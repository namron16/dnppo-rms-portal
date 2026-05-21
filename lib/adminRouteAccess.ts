export type SessionRole = 'admin' | 'PD' | 'DPDA' | 'DPDO' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9' | 'P10'

const DOC_ROUTES = [
  '/admin/master',
  '/admin/admin-orders',
  '/admin/personnel',
  '/admin/daily-journals',
  '/admin/organization',
  '/admin/e-library',
  '/admin/forwarded',
  '/admin/archive',
] as const

const VIEWER_DOC_ROUTES = [
  '/admin/master',
  '/admin/admin-orders',
  '/admin/daily-journals',
  '/admin/organization',
  '/admin/e-library',
  '/admin/forwarded',
  '/admin/archive',
] as const

const P2_DOC_ROUTES = [
  '/admin/master',
  '/admin/admin-orders',
  '/admin/classified-documents',
  '/admin/organization',
  '/admin/e-library',
  '/admin/forwarded',
  '/admin/archive',
] as const

const ADMIN_ROUTES = [
  '/admin/log-history',
  '/admin/user-management',
  '/admin/gdrive',
  '/admin/backup-recovery',
] as const

const DPDA_ROUTES = [
  '/admin/dpda-inbox',
] as const

const P1_ONLY_ROUTES: readonly string[] = []

const ROLE_DEFAULT_ROUTE: Record<SessionRole, string> = {
  admin: '/admin/log-history',
  PD: '/admin/master',
  DPDA: '/admin/dpda-inbox',
  DPDO: '/admin/dpda-inbox',
  P1: '/admin/master',
  P2: '/admin/master',
  P3: '/admin/master',
  P4: '/admin/master',
  P5: '/admin/master',
  P6: '/admin/master',
  P7: '/admin/master',
  P8: '/admin/master',
  P9: '/admin/master',
  P10: '/admin/master',
}

function uniqueRoutes(routes: string[]): string[] {
  return Array.from(new Set(routes))
}

export function getDefaultAdminRoute(role: SessionRole): string {
  return ROLE_DEFAULT_ROUTE[role]
}

export function getAllowedAdminRoutes(role: SessionRole): string[] {
  const viewerRoles = ['P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'] as const
  const docs = role === 'admin'
    ? []
    : role === 'P2'
      ? [...P2_DOC_ROUTES]
      : viewerRoles.includes(role as typeof viewerRoles[number])
        ? [...VIEWER_DOC_ROUTES]
        : [...DOC_ROUTES]
  const admin = role === 'admin' ? [...ADMIN_ROUTES] : []
  const dpdaRoutes = (role === 'DPDA' || role === 'DPDO') ? [...DPDA_ROUTES] : []
  const p1Only = role === 'P1' ? [...P1_ONLY_ROUTES] : []
  return uniqueRoutes([...docs, ...admin, ...dpdaRoutes, ...p1Only])
}

export function isAllowedAdminPath(pathname: string, role: SessionRole): boolean {
  if (pathname === '/admin') return true

  const routes = getAllowedAdminRoutes(role)
  return routes.some(route => pathname === route || pathname.startsWith(`${route}/`))
}
