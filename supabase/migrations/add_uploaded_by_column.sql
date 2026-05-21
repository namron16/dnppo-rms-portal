-- =============================================================================
-- MIGRATION: add_uploaded_by_columns.sql
-- Adds uploaded_by column to all document tables so each user only sees
-- the documents they personally uploaded.
--
-- Run this in your Supabase SQL Editor before deploying the updated code.
-- =============================================================================

-- ── 1. Add uploaded_by columns ───────────────────────────────────────────────

ALTER TABLE public.master_documents
  ADD COLUMN IF NOT EXISTS uploaded_by TEXT;

ALTER TABLE public.special_orders
  ADD COLUMN IF NOT EXISTS uploaded_by TEXT;

ALTER TABLE public.daily_journals
  ADD COLUMN IF NOT EXISTS uploaded_by TEXT;

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS uploaded_by TEXT;

-- ── 2. Add indexes for fast per-user filtering ───────────────────────────────

CREATE INDEX IF NOT EXISTS idx_master_documents_uploaded_by
  ON public.master_documents(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_special_orders_uploaded_by
  ON public.special_orders(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_daily_journals_uploaded_by
  ON public.daily_journals(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_library_items_uploaded_by
  ON public.library_items(uploaded_by);

-- ── 3. Backfill existing records ─────────────────────────────────────────────
--
-- IMPORTANT: Existing records have no uploaded_by value (NULL).
-- The updated page code treats NULL as "visible to everyone" during the
-- migration period so no data disappears for existing users.
--
-- Once you decide which user owns the legacy data, run one of the options
-- below to assign ownership. Replace 'P1' with the correct role/username.
--
-- Option A — assign ALL existing records to a single user (e.g. P1):
--
--   UPDATE public.master_documents SET uploaded_by = 'P1' WHERE uploaded_by IS NULL;
--   UPDATE public.special_orders    SET uploaded_by = 'P1' WHERE uploaded_by IS NULL;
--   UPDATE public.daily_journals    SET uploaded_by = 'P1' WHERE uploaded_by IS NULL;
--   UPDATE public.library_items     SET uploaded_by = 'P1' WHERE uploaded_by IS NULL;
--
-- Option B — assign records based on the records table (matches via entity_id):
--
--   UPDATE public.master_documents md
--   SET    uploaded_by = r.uploaded_by
--   FROM   public.records r
--   WHERE  r.entity_type = 'master_document'
--     AND  r.entity_id   = md.id
--     AND  md.uploaded_by IS NULL;
--
--   UPDATE public.special_orders so
--   SET    uploaded_by = r.uploaded_by
--   FROM   public.records r
--   WHERE  r.entity_type = 'special_order'
--     AND  r.entity_id   = so.id
--     AND  so.uploaded_by IS NULL;
--
--   UPDATE public.daily_journals dj
--   SET    uploaded_by = r.uploaded_by
--   FROM   public.records r
--   WHERE  r.entity_type = 'daily_journal'
--     AND  r.entity_id   = dj.id
--     AND  dj.uploaded_by IS NULL;
--
--   UPDATE public.library_items li
--   SET    uploaded_by = r.uploaded_by
--   FROM   public.records r
--   WHERE  r.entity_type = 'library_item'
--     AND  r.entity_id   = li.id
--     AND  li.uploaded_by IS NULL;
--
-- ── 4. Tighten RLS once backfill is done (optional but recommended) ──────────
--
-- After all records have an uploaded_by value, you can enforce ownership
-- at the database level so no query can accidentally return cross-user data.
-- Only do this AFTER confirming all rows are backfilled (no NULLs remain).
--
--   ALTER TABLE public.master_documents ENABLE ROW LEVEL SECURITY;
--
--   CREATE POLICY master_documents_own
--     ON public.master_documents
--     FOR SELECT
--     TO authenticated
--     USING (
--       uploaded_by = current_setting('request.jwt.claims', TRUE)::json->>'role'
--       OR current_setting('request.jwt.claims', TRUE)::json->>'role'
--            IN ('admin', 'DPDA', 'DPDO')
--     );
--
-- Repeat the same pattern for special_orders, daily_journals, library_items.
-- Service role bypasses RLS automatically so API routes are unaffected.