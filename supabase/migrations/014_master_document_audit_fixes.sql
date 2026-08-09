-- =============================================================================
-- MIGRATION: 014_master_document_audit_fixes.sql
-- Fixes from master-document-audit.md, section 1 (Vulnerabilities) + 4.3 (index)
--
-- What a plain-English summary of each fix means:
--  1.1  Two attachment tables (daily_journal_attachments, library_item_attachments)
--       had NO lock on the door at all — enable RLS + add policies.
--  1.2  master_document_attachments could be read by ANY logged-in user,
--       not just the document's owner — narrow the SELECT policy.
--  1.3  master_documents could be read/edited/deleted by ANY non-admin role,
--       not just the uploader — narrow all four policies to uploaded_by.
--  1.4  p1_inbox_items had full read/write open to unauthenticated (anon) users.
--  4.3  Add a composite index so the common "my docs, not archived" query is fast.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.1 — Enable RLS on the two attachment tables that had none
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.daily_journal_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_item_attachments  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scoped read daily journal attachments"   ON public.daily_journal_attachments;
DROP POLICY IF EXISTS "scoped write daily journal attachments"  ON public.daily_journal_attachments;
DROP POLICY IF EXISTS "scoped read library item attachments"    ON public.library_item_attachments;
DROP POLICY IF EXISTS "scoped write library item attachments"   ON public.library_item_attachments;

CREATE POLICY "scoped read daily journal attachments"
  ON public.daily_journal_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_journals dj
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE dj.id = daily_journal_attachments.daily_journal_id
        AND (dj.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO'))
    )
  );

CREATE POLICY "scoped write daily journal attachments"
  ON public.daily_journal_attachments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_journals dj
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE dj.id = daily_journal_attachments.daily_journal_id
        AND (dj.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.daily_journals dj
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE dj.id = daily_journal_attachments.daily_journal_id
        AND (dj.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO'))
    )
  );

CREATE POLICY "scoped read library item attachments"
  ON public.library_item_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.library_items li
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE li.id = library_item_attachments.library_item_id
        AND (li.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO'))
    )
  );

CREATE POLICY "scoped write library item attachments"
  ON public.library_item_attachments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.library_items li
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE li.id = library_item_attachments.library_item_id
        AND (li.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.library_items li
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE li.id = library_item_attachments.library_item_id
        AND (li.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO'))
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.2 — Narrow master_document_attachments SELECT from USING(true) to
--        "only the owning document's uploader, or a privileged role"
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "authenticated read master attachments" ON public.master_document_attachments;

CREATE POLICY "scoped read master attachments"
  ON public.master_document_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.master_documents md
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE md.id = master_document_attachments.master_document_id
        AND (md.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO'))
    )
  );

-- Same tightening for special_order_attachments' equivalent read-all policy
DROP POLICY IF EXISTS "authenticated read so attachments" ON public.special_order_attachments;

CREATE POLICY "scoped read so attachments"
  ON public.special_order_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.special_orders so
      JOIN public.profiles p ON p.id = auth.uid()
      WHERE so.id = special_order_attachments.special_order_id
        AND (so.uploaded_by = p.role OR p.role IN ('admin','DPDA','DPDO'))
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.3 — master_documents: scope SELECT/UPDATE/DELETE to the uploader
--        (INSERT stays "any non-admin can create", since a doc has no
--        owner yet at insert time — uploaded_by is set by the app on insert)
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "non-admin read master"   ON public.master_documents;
DROP POLICY IF EXISTS "non-admin update master" ON public.master_documents;
DROP POLICY IF EXISTS "non-admin delete master" ON public.master_documents;

CREATE POLICY "scoped read master"
  ON public.master_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR master_documents.uploaded_by = p.role OR master_documents.uploaded_by IS NULL)
    )
  );

CREATE POLICY "scoped update master"
  ON public.master_documents FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR master_documents.uploaded_by = p.role)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR master_documents.uploaded_by = p.role)
    )
  );

CREATE POLICY "scoped delete master"
  ON public.master_documents FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role IN ('admin','DPDA','DPDO') OR master_documents.uploaded_by = p.role)
    )
  );

-- NOTE: uploaded_by = NULL is treated as "visible to everyone" (legacy rows
-- from before add_uploaded_by_column.sql ran) per that migration's stated
-- backfill strategy. Once you backfill all NULLs, drop the "OR ... IS NULL"
-- clause above to close this gap fully.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1.4 — p1_inbox_items: enable RLS, restrict to P1 (and privileged roles),
--        revoke the anon grant entirely
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.p1_inbox_items FROM anon;

ALTER TABLE public.p1_inbox_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "p1 reads own inbox"   ON public.p1_inbox_items;
DROP POLICY IF EXISTS "p1 writes own inbox"  ON public.p1_inbox_items;

CREATE POLICY "p1 reads own inbox"
  ON public.p1_inbox_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('P1','admin','DPDA','DPDO')
    )
  );

CREATE POLICY "p1 writes own inbox"
  ON public.p1_inbox_items FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('P1','admin','DPDA','DPDO')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('P1','admin','DPDA','DPDO')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4.3 — Composite index for the "my active docs" hot-path query
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_master_documents_uploaded_by_archived
  ON public.master_documents(uploaded_by, archived);

COMMENT ON POLICY "scoped read master" ON public.master_documents IS
  'Fix 1.3 (master-document-audit.md): previously any non-admin role could read every document. Now scoped to uploader + privileged roles.';