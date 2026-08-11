// lib/adminRouteAccess.ts
//
// Route access is driven by `nav_group` (stored in user_metadata JWT),
// not by hardcoded role names. This means any new role created via the dashboard
// gets the correct routes automatically without touching this file.
//
// nav_group values:
//   'admin'     → admin-only routes (log history, user management, etc.)
//   'dpda-dpdo' → Deputy (DPDA/DPDO) routes + viewer doc routes
//   'pd'        → Provincial Director — same view-only doc routes as a viewer
//                 account, including the normal Forwarded Files page (NOT the
//                 DPDA/DPDO-only inbox)
//   'documents' → document routes (viewer or full, based on is_viewer_only)
//
// Special roles that still need hardcoded route exceptions:
//   'P1'  → full doc routes (includes 201 files)
//   'P2'  → classified documents route

export type SessionRole = string; // any role string is valid — no fixed union

// ── Route lists ───────────────────────────────────────────────────────────────

const DOC_ROUTES = [
  "/admin/master",
  "/admin/admin-orders",
  "/admin/personnel",
  "/admin/daily-journals",
  "/admin/organization",
  "/admin/e-library",
  "/admin/forwarded",
  "/admin/archive",
] as const;

const VIEWER_DOC_ROUTES = [
  "/admin/master",
  "/admin/admin-orders",
  "/admin/daily-journals",
  "/admin/organization",
  "/admin/e-library",
  "/admin/forwarded",
  "/admin/archive",
] as const;

const P2_DOC_ROUTES = [
  "/admin/master",
  "/admin/admin-orders",
  "/admin/classified-documents",
  "/admin/organization",
  "/admin/e-library",
  "/admin/forwarded",
  "/admin/archive",
] as const;

const ADMIN_ROUTES = [
  "/admin/log-history",
  "/admin/user-management",
  "/admin/gdrive",
  "/admin/backup-recovery",
  "/admin/system-settings",
] as const;

// Both share the same pages but are now separate nav_group values
const DPDA_DPDO_ROUTES = [
  "/admin/master",
  "/admin/admin-orders",
  "/admin/daily-journals",
  "/admin/organization",
  "/admin/e-library",
  "/admin/forwarded",
  "/admin/archive",
  "/admin/dpda-inbox",
  "/admin/inbox",
] as const;

// PD: view-only access to all documents + the normal (non-DPDA) Forwarded
// Files page — identical route set to a regular viewer account.
const PD_ROUTES = [...VIEWER_DOC_ROUTES] as const;

const PUBLIC_ROUTES = ["/privacy-policy", "/terms-and-condition"] as const;

// ── Role info passed in from JWT user_metadata ────────────────────────────────
// The middleware reads these from user_metadata so no DB call is needed.

export interface RoleInfo {
  role: SessionRole;
  nav_group: string; // 'documents' | 'admin' | 'dpda-dpdo' | 'pd'
  is_viewer_only?: boolean;
}

// ── Default route ─────────────────────────────────────────────────────────────
// Uses nav_group when available, falls back to role-name for legacy callers.

export function getDefaultAdminRoute(
  roleOrInfo: SessionRole | RoleInfo
): string {
  // New path: RoleInfo object with nav_group
  if (typeof roleOrInfo === "object") {
    const { nav_group } = roleOrInfo;
    if (nav_group === "admin") return "/admin/log-history";
    if (nav_group === "dpda-dpdo") return "/admin/inbox";
    if (nav_group === "pd") return "/admin/master";

    // 'documents' group — same default for all
    return "/admin/master";
  }

  // Legacy path: plain role string (used by proxy.ts before metadata is available)
  const role = roleOrInfo;
  if (role === "admin") return "/admin/log-history";
  if (role === "DPDA" || role === "DPDO") return "/admin/inbox";
  if (role === "PD") return "/admin/master";
  return "/admin/master";
}

// ── Allowed routes ─────────────────────────────────────────────────────────────

export function getAllowedAdminRoutes(
  roleOrInfo: SessionRole | RoleInfo
): string[] {
  // New path: RoleInfo object with nav_group
  if (typeof roleOrInfo === "object") {
    const { nav_group, role, is_viewer_only } = roleOrInfo;

    if (nav_group === "admin") return [...ADMIN_ROUTES];
    if (nav_group === "dpda-dpdo") return [...DPDA_DPDO_ROUTES];
    if (nav_group === "pd") return [...PD_ROUTES];

    // 'documents' group — check special roles first, then viewer flag
    if (role === "P1") return [...DOC_ROUTES];
    if (role === "P2") return [...P2_DOC_ROUTES];
    if (is_viewer_only) return [...VIEWER_DOC_ROUTES];
    return [...DOC_ROUTES];
  }

  // Legacy path: plain role string
  const role = roleOrInfo;
  if (role === "admin") return [...ADMIN_ROUTES];
  if (role === "DPDA" || role === "DPDO") return [...DPDA_DPDO_ROUTES];
  if (role === "PD") return [...PD_ROUTES];
  if (role === "P1") return [...DOC_ROUTES];
  if (role === "P2") return [...P2_DOC_ROUTES];
  return [...VIEWER_DOC_ROUTES];
}

// ── Path check ────────────────────────────────────────────────────────────────

export function isAllowedAdminPath(
  pathname: string,
  roleOrInfo: SessionRole | RoleInfo
): boolean {
  if (pathname === "/admin") return true;
  if (PUBLIC_ROUTES.some((r) => pathname === r)) return true;
  const routes = getAllowedAdminRoutes(roleOrInfo);
  return routes.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}
