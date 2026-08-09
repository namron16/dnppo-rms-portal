-- =============================================================================
-- MIGRATION: 015_admin_orders_audit_fixes.sql
-- Fixes from admin-orders-audit.md, section 1 (Vulnerabilities)
--
-- 1.1  special_order_attachments had RLS commented out AND a blanket
--      GRANT ... TO anon — anyone with the public anon key could read/write
--      this table without logging in. Enable RLS, scope to owner, drop the
--      anon grant.
-- 1.4  admin_logs INSERT policy only checked user_id = auth.uid() — it never
--      verified the `role` column being inserted actually matches the
--      caller's real profile role. Any authenticated user could insert a
--      log row claiming role = 'admin' (or any role), spoofing the audit
--      trail. Add a role-match check.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.1 — special_order_attachments: enable RLS, scope to the owning order's
--        uploader (or privileged roles), revoke the anon grant.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.special_order_attachments FROM anon;

ALTER TABLE public.special_order_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scoped read special order attachments"  ON public.special_order_attachments;
DROP POLICY IF EXISTS "scoped write special order attachments" ON public.special_order_attachments;

CREATE POLICY "scoped read special order attachments"
  ON public.special_order_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.special_orders so
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE so.id = special_order_attachments.special_order_id
        AND (so.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO') OR so.uploaded_by IS NULL)
    )
  );

CREATE POLICY "scoped write special order attachments"
  ON public.special_order_attachments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.special_orders so
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE so.id = special_order_attachments.special_order_id
        AND (so.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.special_orders so
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE so.id = special_order_attachments.special_order_id
        AND (so.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO'))
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.4 — admin_logs: prevent role spoofing on insert.
--        The row's `role` column must match the caller's own profile role.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "insert own log" ON public.admin_logs;

CREATE POLICY "insert own log"
  ON public.admin_logs FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

COMMENT ON POLICY "insert own log" ON public.admin_logs IS
  'Fix 1.4 (admin-orders-audit.md): role column must match the inserting user''s actual profile role — prevents audit-log spoofing.';

COMMENT ON POLICY "scoped read special order attachments" ON public.special_order_attachments IS
  'Fix 1.1 (admin-orders-audit.md): table previously had no RLS and granted anon full CRUD.';