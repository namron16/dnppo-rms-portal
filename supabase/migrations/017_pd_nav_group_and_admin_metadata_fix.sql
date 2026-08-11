-- =============================================================================
-- MIGRATION: 017_pd_nav_group_and_admin_metadata_fix.sql
--
-- WHAT THIS FIXES:
--   1. Upgrades the existing 'PD' role_registry row to nav_group = 'pd'
--      (new dedicated wristband, separate from 'documents').
--   2. Backfills JWT metadata (auth.users.raw_user_meta_data) for ANY account
--      whose nav_group is out of sync with role_registry — this covers the
--      'dale' case and any future accounts created before a role_registry
--      update, or where the create-account modal's nav_group value didn't
--      make it into the JWT for some reason.
--   3. Adds 'PD' to every "can view all documents" (view-only) RLS policy,
--      alongside 'admin', 'DPDA', 'DPDO' — so PD accounts can see every
--      document/attachment across all four modules, matching Deputy access.
--      PD is NOT added to any WRITE/DELETE policy — view-only, as requested.
--
-- SAFE TO RE-RUN: every statement is idempotent (DROP POLICY IF EXISTS first,
-- UPDATE ... WHERE conditions only touch rows that need it).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Upgrade PD role_registry row
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.role_registry
SET
  nav_group      = 'pd',
  is_viewer_only = TRUE,   -- PD is view-only, same as DPDA/DPDO for documents
  can_upload     = FALSE   -- PD does not upload documents
WHERE role = 'PD';

-- Safety net: if the PD row somehow doesn't exist yet, create it
INSERT INTO public.role_registry
  (role, display_name, title, nav_group, default_route, can_upload, is_viewer_only, sort_order)
VALUES
  ('PD', 'Provincial Director', 'Provincial Director', 'pd', '/admin/master', FALSE, TRUE, 1)
ON CONFLICT (role) DO UPDATE SET
  nav_group      = 'pd',
  is_viewer_only = TRUE,
  can_upload     = FALSE,
  is_active      = TRUE;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill JWT metadata wherever it's out of sync with role_registry
--    (fixes 'dale'-style accounts, and any future account with the same
--    creation-time mismatch — this is your "consistency net" going forward)
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE auth.users AS u
SET raw_user_meta_data = u.raw_user_meta_data || jsonb_build_object(
  'nav_group',      rr.nav_group,
  'is_viewer_only', COALESCE(rr.is_viewer_only, true)
)
FROM public.profiles p
JOIN public.role_registry rr ON rr.role = p.role
WHERE u.id = p.id
  AND (u.raw_user_meta_data->>'nav_group') IS DISTINCT FROM rr.nav_group;

COMMENT ON TABLE public.role_registry IS
  'Single source of truth for nav_group. If a user''s dashboard shows the wrong nav tabs, re-run the backfill UPDATE above — it syncs auth.users.raw_user_meta_data (the JWT) from this table. Users must log out and back in for a refreshed JWT to take effect.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add 'PD' to "can view all documents" (view-only) RLS policies
--    Pattern matches migrations 014 and 016 exactly — just adds 'PD' to the
--    privileged-role IN (...) lists. PD is intentionally excluded from the
--    UPDATE/DELETE policies below (kept as-is) — view-only.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── master_documents ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "scoped read master" ON public.master_documents;
CREATE POLICY "scoped read master"
  ON public.master_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO','PD') OR master_documents.uploaded_by = p.role OR master_documents.uploaded_by IS NULL)
    )
  );

-- ── special_orders ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "scoped read special orders" ON public.special_orders;
CREATE POLICY "scoped read special orders"
  ON public.special_orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO','PD') OR special_orders.uploaded_by = p.role OR special_orders.uploaded_by IS NULL)
    )
  );

-- ── daily_journals ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "scoped read daily journals" ON public.daily_journals;
CREATE POLICY "scoped read daily journals"
  ON public.daily_journals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO','PD') OR daily_journals.uploaded_by = p.role OR daily_journals.uploaded_by IS NULL)
    )
  );

-- ── library_items ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "scoped read library items" ON public.library_items;
CREATE POLICY "scoped read library items"
  ON public.library_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO','PD') OR library_items.uploaded_by = p.role OR library_items.uploaded_by IS NULL)
    )
  );

-- ── master_document_attachments ───────────────────────────────────────────
DROP POLICY IF EXISTS "scoped read master attachments" ON public.master_document_attachments;
CREATE POLICY "scoped read master attachments"
  ON public.master_document_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.master_documents md
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE md.id = master_document_attachments.master_document_id
        AND (md.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO','PD'))
    )
  );

-- ── special_order_attachments ─────────────────────────────────────────────
DROP POLICY IF EXISTS "scoped read so attachments" ON public.special_order_attachments;
CREATE POLICY "scoped read so attachments"
  ON public.special_order_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.special_orders so
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE so.id = special_order_attachments.special_order_id
        AND (so.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO','PD'))
    )
  );

-- Also update the write-scoped policy's SELECT-relevant USING clause is unaffected
-- (writes stay restricted to owner + admin/DPDA/DPDO — PD is NOT added here,
-- since PD must remain view-only for attachments as well).

-- ── daily_journal_attachments ─────────────────────────────────────────────
DROP POLICY IF EXISTS "scoped read daily journal attachments" ON public.daily_journal_attachments;
CREATE POLICY "scoped read daily journal attachments"
  ON public.daily_journal_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_journals dj
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE dj.id = daily_journal_attachments.daily_journal_id
        AND (dj.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO','PD'))
    )
  );

-- ── library_item_attachments ──────────────────────────────────────────────
DROP POLICY IF EXISTS "scoped read library item attachments" ON public.library_item_attachments;
CREATE POLICY "scoped read library item attachments"
  ON public.library_item_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.library_items li
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE li.id = library_item_attachments.library_item_id
        AND (li.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO','PD'))
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Allow PD to read the Forwarded Files inbox like a normal (non-admin)
--    account. forwarded_documents' existing "recipient selects own forwarded
--    docs" / "sender selects own sent docs" policies already key off
--    recipient_role / sender_role = profiles.role — no IN(...) allowlist to
--    touch. PD works automatically once profiles.role = 'PD' and the account
--    forwards/receives like any other role. No change needed here.
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON POLICY "scoped read master" ON public.master_documents IS
  'Fix 017: added PD to the privileged view-all list, alongside admin/DPDA/DPDO. PD remains view-only — not added to UPDATE/DELETE policies.';