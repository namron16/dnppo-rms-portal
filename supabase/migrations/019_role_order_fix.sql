-- =============================================================================
-- MIGRATION: 019_role_order_fix.sql
--
-- GOAL: accounts always appear as
--   admin, PD, DPDA, DPDO, P1-P10, WCPD, PPSMU, then newer accounts
--   (oldest created first).
--
-- WHAT WAS WRONG
--   1. register_role() overwrote sort_order on every call. Editing a role in
--      User Management (or running seed-admins.ts) reset it to 100, so that
--      account jumped to the bottom of the list.
--   2. get_active_roles() sorted by sort_order only. New accounts all have
--      sort_order = 100, so their order was random.
--
-- Safe to re-run.
-- =============================================================================

-- 1. Repair sort_order for the built-in accounts ------------------------------
UPDATE public.role_registry rr
SET sort_order = v.so
FROM (VALUES
  ('admin', 0), ('PD', 1), ('DPDA', 2), ('DPDO', 3),
  ('P1', 10), ('P2', 11), ('P3', 12), ('P4', 13), ('P5', 14),
  ('P6', 15), ('P7', 16), ('P8', 17), ('P9', 18), ('P10', 19),
  ('WCPD', 20), ('PPSMU', 21)
) AS v(role, so)
WHERE rr.role = v.role
  AND rr.sort_order IS DISTINCT FROM v.so;

-- 2. get_active_roles: tie-break by creation date (oldest first) --------------
CREATE OR REPLACE FUNCTION public.get_active_roles()
RETURNS TABLE (
  role           TEXT,
  display_name   TEXT,
  title          TEXT,
  nav_group      TEXT,
  default_route  TEXT,
  can_upload     BOOLEAN,
  is_viewer_only BOOLEAN,
  sort_order     INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rr.role, rr.display_name, rr.title, rr.nav_group, rr.default_route,
         rr.can_upload, rr.is_viewer_only, rr.sort_order
  FROM public.role_registry rr
  WHERE rr.is_active = TRUE
  ORDER BY rr.sort_order ASC, rr.created_at ASC, rr.role ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_roles() TO anon, authenticated, service_role;

-- 3. register_role: never overwrite sort_order / created_by on update ---------
CREATE OR REPLACE FUNCTION public.register_role(
  p_role           TEXT,
  p_display_name   TEXT,
  p_title          TEXT,
  p_nav_group      TEXT DEFAULT 'documents',
  p_default_route  TEXT DEFAULT '/admin/master',
  p_can_upload     BOOLEAN DEFAULT TRUE,
  p_is_viewer_only BOOLEAN DEFAULT TRUE,
  p_sort_order     INT DEFAULT 100,
  p_created_by     TEXT DEFAULT 'admin'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.role_registry (
    role, display_name, title, nav_group, default_route,
    can_upload, is_viewer_only, sort_order, created_by
  ) VALUES (
    p_role, p_display_name, p_title, p_nav_group, p_default_route,
    p_can_upload, p_is_viewer_only, p_sort_order, p_created_by
  )
  ON CONFLICT (role) DO UPDATE SET
    display_name   = EXCLUDED.display_name,
    title          = EXCLUDED.title,
    nav_group      = EXCLUDED.nav_group,
    default_route  = EXCLUDED.default_route,
    can_upload     = EXCLUDED.can_upload,
    is_viewer_only = EXCLUDED.is_viewer_only,
    is_active      = TRUE;
    -- sort_order intentionally NOT updated: it keeps the account's position.
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_role(TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,INT,TEXT) TO service_role;