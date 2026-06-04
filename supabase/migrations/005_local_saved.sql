-- migrations/005_local_saved.sql
--
-- Adds the local_saved column to backup_jobs so the pending-local-saves
-- queue knows which completed jobs have already been written to the admin's
-- local device and which still need to be saved.
--
-- Run this in your Supabase SQL editor or via the Supabase CLI:
--   supabase db push  (if using migrations folder)
--   or paste directly into Supabase Dashboard → SQL Editor

ALTER TABLE backup_jobs
  ADD COLUMN IF NOT EXISTS local_saved BOOLEAN NOT NULL DEFAULT FALSE;

-- Index so the pending-local-saves query is fast even on large tables
CREATE INDEX IF NOT EXISTS idx_backup_jobs_pending_local_save
  ON backup_jobs (status, local_saved, completed_at)
  WHERE status = 'completed' AND local_saved = FALSE;

COMMENT ON COLUMN backup_jobs.local_saved IS
  'TRUE after the admin''s browser has successfully written this backup ZIP '
  'to the configured local device folder. Set by /api/backup/mark-local-saved.';