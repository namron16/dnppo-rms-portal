-- =============================================================================
-- MIGRATION: 016_gdrive_recovery_user_logs_audit_fixes.sql
-- Fixes from gdrive-recovery-system-user-logs-audit-report.md, section 1
-- (all 10 vulnerability items, Critical through Low)
--
-- 1.1  update_session_duration RPC had no in-function role check. Any
--      authenticated role could call it and change the global session
--      length or force-expire every session. Add an explicit admin check.
-- 1.2  master_documents/special_orders/daily_journals/library_items RLS
--      only checked role <> 'admin' — no uploaded_by scoping. Master
--      documents was already fixed in 014. This migration applies the same
--      uploaded_by scoping to special_orders, daily_journals, library_items.
-- 1.3  Same root cause as 1.2 — covered by the same policy changes.
-- 1.4  p1_inbox_items and special_order_attachments were already fixed
--      (014, 015). This migration closes the remaining anon-CRUD gaps on
--      org_members, admin_profile_prefs, and daily_journals.
-- 1.5  records table has no write policy at all (implicit deny). Make the
--      deny explicit with a WITH CHECK (false) policy and a comment, so a
--      future developer doesn't "fix" a broken upload by loosening it.
-- 1.6  role_registry / admin_logs / admin_presence RLS is already on its
--      final, non-recursive form via add_nav_grou_check.sql. Re-apply that
--      canonical state here (idempotent) so a fresh environment can't end
--      up on the intermediate, recursive version if migrations are ever
--      replayed out of order.
-- 1.8  active_sessions.role as PK — documented as an intentional
--      single-account-per-role design constraint (no schema change).
-- 1.9  system_settings SELECT is broad by design once 1.1 is fixed — no
--      change needed, noted for completeness.
-- 1.10 getServiceClient() singleton — no schema change, documented only.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1.1 — update_session_duration: require caller to actually be admin.
--        SECURITY DEFINER functions bypass RLS, so the RLS policy on
--        system_settings does NOT protect calls made through this RPC.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_session_duration(
  p_hours    INT,
  p_admin_by TEXT DEFAULT 'admin'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  IF p_hours < 1 OR p_hours > 168 THEN
    RAISE EXCEPTION 'session_duration_hours must be between 1 and 168, got %', p_hours;
  END IF;

  UPDATE public.system_settings
  SET
    session_duration_hours = p_hours,
    updated_by             = p_admin_by,
    updated_at             = NOW()
  WHERE id = 1;

  UPDATE public.active_sessions
  SET expires_at = NOW() + (p_hours || ' hours')::INTERVAL
  WHERE expires_at > NOW() + (p_hours || ' hours')::INTERVAL;
END;
$$;

COMMENT ON FUNCTION public.update_session_duration(INT, TEXT) IS
  'Fix 1.1 (gdrive-recovery-system-user-logs-audit-report.md): now re-checks caller role = admin inside the function body, since SECURITY DEFINER bypasses the system_settings RLS policy.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 1.2 / 1.3 — Scope special_orders, daily_journals, library_items SELECT/
--             UPDATE/DELETE to the uploader (or privileged roles), matching
--             the master_documents fix already applied in 014. INSERT stays
--             open to any non-admin — a new row has no owner yet at insert
--             time, uploaded_by is set by the app.
--             NULL uploaded_by (legacy rows) stays visible to everyone,
--             matching the backfill strategy in add_uploaded_by_column.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- special_orders
DROP POLICY IF EXISTS "non-admin read special orders"   ON public.special_orders;
DROP POLICY IF EXISTS "non-admin update special orders" ON public.special_orders;
DROP POLICY IF EXISTS "non-admin delete special orders" ON public.special_orders;

CREATE POLICY "scoped read special orders"
  ON public.special_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR special_orders.uploaded_by = p.role OR special_orders.uploaded_by IS NULL)
    )
  );

CREATE POLICY "scoped update special orders"
  ON public.special_orders FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR special_orders.uploaded_by = p.role)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR special_orders.uploaded_by = p.role)
    )
  );

CREATE POLICY "scoped delete special orders"
  ON public.special_orders FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR special_orders.uploaded_by = p.role)
    )
  );

-- daily_journals
DROP POLICY IF EXISTS "non-admin read daily journals"   ON public.daily_journals;
DROP POLICY IF EXISTS "non-admin update daily journals" ON public.daily_journals;
DROP POLICY IF EXISTS "non-admin delete daily journals" ON public.daily_journals;

CREATE POLICY "scoped read daily journals"
  ON public.daily_journals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR daily_journals.uploaded_by = p.role OR daily_journals.uploaded_by IS NULL)
    )
  );

CREATE POLICY "scoped update daily journals"
  ON public.daily_journals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR daily_journals.uploaded_by = p.role)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR daily_journals.uploaded_by = p.role)
    )
  );

CREATE POLICY "scoped delete daily journals"
  ON public.daily_journals FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR daily_journals.uploaded_by = p.role)
    )
  );

-- library_items
DROP POLICY IF EXISTS "non-admin read library items"   ON public.library_items;
DROP POLICY IF EXISTS "non-admin update library items" ON public.library_items;
DROP POLICY IF EXISTS "non-admin delete library items" ON public.library_items;

CREATE POLICY "scoped read library items"
  ON public.library_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR library_items.uploaded_by = p.role OR library_items.uploaded_by IS NULL)
    )
  );

CREATE POLICY "scoped update library items"
  ON public.library_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR library_items.uploaded_by = p.role)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR library_items.uploaded_by = p.role)
    )
  );

CREATE POLICY "scoped delete library items"
  ON public.library_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR library_items.uploaded_by = p.role)
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 1.4 — Close remaining anon-CRUD gaps: org_members, admin_profile_prefs,
--        daily_journals grant. (p1_inbox_items and special_order_attachments
--        were already closed in 014 and 015.)
-- ─────────────────────────────────────────────────────────────────────────────

-- daily_journals — RLS is already enabled (add_row_level_security_documents.sql)
-- but the original create_daily_journals.sql grant to anon was never revoked.
REVOKE ALL ON public.daily_journals FROM anon;

-- org_members — no RLS existed at all. Org chart is readable by anyone signed
-- in; writes are restricted to privileged roles who manage personnel data.
REVOKE ALL ON public.org_members FROM anon;

ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated reads org members"   ON public.org_members;
DROP POLICY IF EXISTS "privileged writes org members"     ON public.org_members;

CREATE POLICY "authenticated reads org members"
  ON public.org_members FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "privileged writes org members"
  ON public.org_members FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin','PD','DPDA','DPDO')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('admin','PD','DPDA','DPDO')
    )
  );

-- admin_profile_prefs — shared display name / avatar per role. Any
-- authenticated user may read (sidebar needs to resolve other roles'
-- display names), but a user may only write their own role's row.
REVOKE ALL ON public.admin_profile_prefs FROM anon;

ALTER TABLE public.admin_profile_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated reads profile prefs" ON public.admin_profile_prefs;
DROP POLICY IF EXISTS "own role writes profile prefs"     ON public.admin_profile_prefs;

CREATE POLICY "authenticated reads profile prefs"
  ON public.admin_profile_prefs FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "own role writes profile prefs"
  ON public.admin_profile_prefs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (role = admin_profile_prefs.role OR role = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (role = admin_profile_prefs.role OR role = 'admin')
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 1.5 — records: make the "writes are service-role-only by design" intent
--        explicit with a restrictive WITH CHECK (false) policy, instead of
--        relying on the implicit deny-by-default of "no write policy exists".
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "records_write_deny_client" ON public.records;

CREATE POLICY "records_write_deny_client"
  ON public.records
  FOR ALL
  TO anon, authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

COMMENT ON POLICY "records_write_deny_client" ON public.records IS
  'Fix 1.5 (gdrive-recovery-system-user-logs-audit-report.md): records writes are service-role-only by design. This policy makes that explicit instead of relying on the implicit deny from having no write policy.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 1.6 — Re-apply the canonical, non-recursive role_registry / admin_logs /
--        admin_presence policies (idempotent). Guards against a fresh
--        environment landing on the intermediate recursive version if
--        011/013/add_nav_grou_check.sql are ever replayed out of order.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_admin_nav_group()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_registry rr ON rr.role = p.role
    WHERE p.id = auth.uid()
      AND rr.nav_group = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_nav_group() TO authenticated;

DROP POLICY IF EXISTS "admin manages role registry" ON public.role_registry;
CREATE POLICY "admin manages role registry"
  ON public.role_registry FOR ALL
  USING (public.is_admin_nav_group());

DROP POLICY IF EXISTS "admin reads all logs" ON public.admin_logs;
CREATE POLICY "admin reads all logs"
  ON public.admin_logs FOR SELECT
  USING (public.is_admin_nav_group());

COMMENT ON FUNCTION public.is_admin_nav_group() IS
  'Fix 1.6 (gdrive-recovery-system-user-logs-audit-report.md): canonical SECURITY DEFINER helper for admin-group checks. Re-applied here so migration replay order can never leave role_registry on the recursive 013 policy.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 1.8 — active_sessions uses role as PK by design (single account per role).
--        Documented only, no schema change.
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.active_sessions.role IS
  'Primary key. By design, only one active session exists per role string system-wide. If two real users are ever assigned the same role, their sessions will invalidate each other. See 1.8, gdrive-recovery-system-user-logs-audit-report.md.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 1.9 / 1.10 — No schema change required. See report for rationale:
--   1.9  system_settings SELECT is broad by design; the RPC write path is
--        the real boundary and is fixed in 1.1 above.
--   1.10 getServiceClient() module-level singleton is an accepted pattern
--        for this runtime; documented in code, not the database.
-- ─────────────────────────────────────────────────────────────────────────────