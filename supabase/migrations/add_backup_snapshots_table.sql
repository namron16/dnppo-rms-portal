CREATE TABLE IF NOT EXISTS public.backup_snapshots (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_id  TEXT NOT NULL UNIQUE,
  module_name  TEXT NOT NULL,
  snapshot_data JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
GRANT ALL ON public.backup_snapshots TO service_role;