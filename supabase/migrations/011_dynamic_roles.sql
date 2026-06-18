
CREATE TABLE IF NOT EXISTS public.role_registry (
  role           TEXT PRIMARY KEY,                   -- e.g. 'P11', 'FINANCE', 'WCPD'
  display_name   TEXT NOT NULL,                      -- e.g. 'Finance Officer'
  title          TEXT NOT NULL,                      -- shown under avatar in sidebar
  nav_group      TEXT NOT NULL DEFAULT 'documents',  -- 'documents' | 'admin' | 'dpda'
  default_route  TEXT NOT NULL DEFAULT '/admin/master',
  can_upload     BOOLEAN NOT NULL DEFAULT TRUE,
  is_viewer_only BOOLEAN NOT NULL DEFAULT TRUE,      -- TRUE = no 201 files tab
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INT NOT NULL DEFAULT 100,           -- controls sidebar order
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     TEXT NOT NULL DEFAULT 'admin'
);

-- Seed all existing hardcoded roles so nothing breaks
INSERT INTO public.role_registry
  (role, display_name, title, nav_group, default_route, can_upload, is_viewer_only, sort_order)
VALUES
  ('admin',  'Super Administrator',                    'System Administrator', 'admin',     '/admin/log-history', FALSE, FALSE, 0),
  ('PD',     'Provincial Director',                    'Provincial Director',  'documents', '/admin/master',       FALSE, FALSE, 1),
  ('DPDA',   'Deputy Director for Administration',     'DPDA',                 'dpda',      '/admin/inbox',   FALSE, FALSE, 2),
  ('DPDO',   'Deputy Director for Operations',         'DPDO',                 'dpda',      '/admin/inbox',   FALSE, FALSE, 3),
  ('P1',     'Records Officer',                        'Admin Officer P1',     'documents', '/admin/master',        TRUE, FALSE, 10),
  ('P2',     'Admin Officer P2',                       'Admin Officer P2',     'documents', '/admin/master',        TRUE, FALSE, 11),
  ('P3',     'Admin Officer P3',                       'Admin Officer P3',     'documents', '/admin/master',        TRUE,  TRUE, 12),
  ('P4',     'Admin Officer P4',                       'Admin Officer P4',     'documents', '/admin/master',        TRUE,  TRUE, 13),
  ('P5',     'Admin Officer P5',                       'Admin Officer P5',     'documents', '/admin/master',        TRUE,  TRUE, 14),
  ('P6',     'Admin Officer P6',                       'Admin Officer P6',     'documents', '/admin/master',        TRUE,  TRUE, 15),
  ('P7',     'Admin Officer P7',                       'Admin Officer P7',     'documents', '/admin/master',        TRUE,  TRUE, 16),
  ('P8',     'Admin Officer P8',                       'Admin Officer P8',     'documents', '/admin/master',        TRUE,  TRUE, 17),
  ('P9',     'Admin Officer P9',                       'Admin Officer P9',     'documents', '/admin/master',        TRUE,  TRUE, 18),
  ('P10',    'Admin Officer P10',                      'Admin Officer P10',    'documents', '/admin/master',        TRUE,  TRUE, 19),
  ('WCPD',   'Women and Children Protection Desk',     'Admin Officer WCPD',   'documents', '/admin/master',        TRUE,  TRUE, 20),
  ('PPSMU',  'Provincial Police Strategy Management Unit', 'Admin Officer PPSMU', 'documents', '/admin/master',    TRUE,  TRUE, 21)
ON CONFLICT (role) DO NOTHING;

-- ── RPC: get all active roles (called by login page and sidebar) ──────────────
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
  SELECT role, display_name, title, nav_group, default_route,
         can_upload, is_viewer_only, sort_order
  FROM public.role_registry
  WHERE is_active = TRUE
  ORDER BY sort_order ASC;
$$;

-- ── RPC: register a new role ──────────────────────────────────────────────────
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
    sort_order     = EXCLUDED.sort_order,
    is_active      = TRUE;
END;
$$;

-- ── RPC: deactivate a role (soft-delete from registry) ───────────────────────
-- Called after the auth user and profile are deleted.
-- We soft-delete instead of hard-delete so log history entries still have
-- a role name to display (the ROLE_META fallback in log-history handles the rest).
CREATE OR REPLACE FUNCTION public.deactivate_role(p_role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.role_registry
  SET is_active = FALSE
  WHERE role = p_role;
END;
$$;

-- Drop the hardcoded role check so new roles aren't rejected
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.role_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin manages role registry"
  ON public.role_registry FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "authenticated reads active roles"
  ON public.role_registry FOR SELECT
  TO authenticated, anon
  USING (is_active = TRUE);

GRANT ALL ON public.role_registry TO service_role;
GRANT SELECT ON public.role_registry TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_roles()    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_role(TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN,INT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_role(TEXT) TO service_role;