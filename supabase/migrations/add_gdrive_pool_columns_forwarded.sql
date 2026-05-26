-- Add Drive-pool columns to master_documents
ALTER TABLE public.master_documents
  ADD COLUMN IF NOT EXISTS gdrive_file_id  TEXT,
  ADD COLUMN IF NOT EXISTS gdrive_url      TEXT,
  ADD COLUMN IF NOT EXISTS pool_account_id TEXT,
  ADD COLUMN IF NOT EXISTS file_name       TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type       TEXT,
  ADD COLUMN IF NOT EXISTS source          TEXT DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS forwarded_from  TEXT;

-- Same for special_orders
ALTER TABLE public.special_orders
  ADD COLUMN IF NOT EXISTS gdrive_file_id  TEXT,
  ADD COLUMN IF NOT EXISTS gdrive_url      TEXT,
  ADD COLUMN IF NOT EXISTS pool_account_id TEXT,
  ADD COLUMN IF NOT EXISTS file_name       TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type       TEXT,
  ADD COLUMN IF NOT EXISTS source          TEXT DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS forwarded_from  TEXT;

-- Same for daily_journals
ALTER TABLE public.daily_journals
  ADD COLUMN IF NOT EXISTS gdrive_file_id  TEXT,
  ADD COLUMN IF NOT EXISTS gdrive_url      TEXT,
  ADD COLUMN IF NOT EXISTS pool_account_id TEXT,
  ADD COLUMN IF NOT EXISTS file_name       TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type       TEXT,
  ADD COLUMN IF NOT EXISTS source          TEXT DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS forwarded_from  TEXT;

-- Same for library_items
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS gdrive_file_id  TEXT,
  ADD COLUMN IF NOT EXISTS gdrive_url      TEXT,
  ADD COLUMN IF NOT EXISTS pool_account_id TEXT,
  ADD COLUMN IF NOT EXISTS file_name       TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type       TEXT,
  ADD COLUMN IF NOT EXISTS source          TEXT DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS forwarded_from  TEXT;