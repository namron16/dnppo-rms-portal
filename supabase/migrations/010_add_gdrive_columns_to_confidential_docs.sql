-- =============================================================================
-- MIGRATION: 010_add_gdrive_columns_to_confidential_docs.sql
-- Adds the missing Drive-pool columns to confidential_docs so that:
--   • delete actually removes the Drive file
--   • archive can move the Drive file to the archive subfolder
-- Run AFTER migrations 001–009.
-- =============================================================================

ALTER TABLE public.confidential_docs
  ADD COLUMN IF NOT EXISTS gdrive_file_id  TEXT,
  ADD COLUMN IF NOT EXISTS gdrive_url      TEXT,
  ADD COLUMN IF NOT EXISTS pool_account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_confidential_docs_gdrive_file_id
  ON public.confidential_docs(gdrive_file_id);

COMMENT ON COLUMN public.confidential_docs.gdrive_file_id  IS 'Google Drive file ID — required for delete and archive operations.';
COMMENT ON COLUMN public.confidential_docs.gdrive_url      IS 'Google Drive webViewLink — display/preview URL.';
COMMENT ON COLUMN public.confidential_docs.pool_account_id IS 'storage_pool.id of the Drive account that holds the file.';