-- =============================================================================
-- MIGRATION: 004_backup_recovery_schema.sql
-- Backup & Recovery System — Core Schema
-- Run AFTER migrations 001–003
-- =============================================================================

-- ENUM: backup frequency
DO $$ BEGIN
  CREATE TYPE backup_frequency_enum AS ENUM (
    'daily', 'weekly', 'monthly', 'yearly', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ENUM: backup status
DO $$ BEGIN
  CREATE TYPE backup_status_enum AS ENUM (
    'pending', 'running', 'completed', 'failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ENUM: backup type
DO $$ BEGIN
  CREATE TYPE backup_type_enum AS ENUM (
    'full', 'incremental', 'differential', 'manual'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- TABLE: backup_configs
-- Stores the Super Admin's backup schedule configuration per module.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.backup_configs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  module_name         TEXT NOT NULL,          -- 'master_documents', 'admin_orders', etc.
  is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  frequency           backup_frequency_enum NOT NULL DEFAULT 'daily',
  custom_cron         TEXT,                   -- e.g. '0 2 * * *' for custom frequency
  backup_type         backup_type_enum NOT NULL DEFAULT 'full',
  include_attachments BOOLEAN NOT NULL DEFAULT TRUE,
  encrypt_backup      BOOLEAN NOT NULL DEFAULT TRUE,
  retention_days      INT NOT NULL DEFAULT 90, -- auto-delete backups older than N days
  destination_path    TEXT,                   -- local device folder path (set by admin)
  last_configured_by  TEXT NOT NULL DEFAULT 'P1',
  last_configured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_backup_config_module UNIQUE (module_name)
);

-- =============================================================================
-- TABLE: backup_jobs
-- Immutable log of every backup attempt (scheduled or manual).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.backup_jobs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_id           UUID REFERENCES public.backup_configs(id) ON DELETE SET NULL,
  module_name         TEXT NOT NULL,
  backup_type         backup_type_enum NOT NULL,
  frequency           backup_frequency_enum NOT NULL,
  status              backup_status_enum NOT NULL DEFAULT 'pending',
  triggered_by        TEXT NOT NULL,           -- 'scheduler' | 'P1' | 'system'
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  duration_seconds    INT,

  -- Output
  backup_folder_name  TEXT,                   -- e.g. 'Backup_2026-05-16_02-00-AM'
  backup_path         TEXT,                   -- full local path
  file_count          INT DEFAULT 0,
  total_size_bytes    BIGINT DEFAULT 0,
  manifest_checksum   TEXT,                   -- SHA-256 of manifest file
  encryption_key_hint TEXT,                   -- key identifier (never the key itself)

  -- Error tracking
  error_message       TEXT,
  retry_count         INT NOT NULL DEFAULT 0,

  -- Audit
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_jobs_module    ON public.backup_jobs(module_name);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_status    ON public.backup_jobs(status);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_created   ON public.backup_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_config    ON public.backup_jobs(config_id);

-- =============================================================================
-- TABLE: recovery_jobs
-- Log of every recovery/restore operation.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.recovery_jobs (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  backup_job_id       UUID REFERENCES public.backup_jobs(id) ON DELETE SET NULL,
  module_name         TEXT NOT NULL,
  status              backup_status_enum NOT NULL DEFAULT 'pending',
  triggered_by        TEXT NOT NULL DEFAULT 'P1',
  recovery_point      TIMESTAMPTZ,            -- timestamp of backup being restored
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  duration_seconds    INT,
  records_restored    INT DEFAULT 0,
  files_restored      INT DEFAULT 0,
  validation_passed   BOOLEAN,
  rollback_snapshot   TEXT,                   -- pre-recovery snapshot reference
  error_message       TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_jobs_module  ON public.recovery_jobs(module_name);
CREATE INDEX IF NOT EXISTS idx_recovery_jobs_created ON public.recovery_jobs(created_at DESC);

-- =============================================================================
-- TABLE: backup_notifications
-- Stores notification events for backup success/failure.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.backup_notifications (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  backup_job_id UUID REFERENCES public.backup_jobs(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,    -- 'success' | 'failure' | 'warning' | 'recovery'
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- RPC: get_backup_health_summary
-- Returns aggregated backup health stats for the dashboard.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_backup_health_summary()
RETURNS TABLE (
  total_backups       BIGINT,
  successful_backups  BIGINT,
  failed_backups      BIGINT,
  last_success_at     TIMESTAMPTZ,
  last_failure_at     TIMESTAMPTZ,
  total_size_gb       NUMERIC,
  health_score        NUMERIC,   -- 0–100
  recovery_ready      BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH stats AS (
    SELECT
      COUNT(*)                                             AS total,
      COUNT(*) FILTER (WHERE status = 'completed')        AS successes,
      COUNT(*) FILTER (WHERE status = 'failed')           AS failures,
      MAX(completed_at) FILTER (WHERE status = 'completed') AS last_ok,
      MAX(completed_at) FILTER (WHERE status = 'failed')    AS last_fail,
      ROUND(SUM(total_size_bytes) / 1073741824.0, 2)       AS size_gb
    FROM public.backup_jobs
    WHERE created_at >= NOW() - INTERVAL '30 days'
  )
  SELECT
    total,
    successes,
    failures,
    last_ok,
    last_fail,
    size_gb,
    CASE WHEN total = 0 THEN 0
         ELSE ROUND((successes::NUMERIC / total) * 100, 1)
    END AS health_score,
    (last_ok IS NOT NULL AND last_ok >= NOW() - INTERVAL '25 hours') AS recovery_ready
  FROM stats;
$$;

GRANT EXECUTE ON FUNCTION public.get_backup_health_summary() TO service_role;

-- Auto-update triggers
CREATE TRIGGER trg_backup_configs_updated_at
  BEFORE UPDATE ON public.backup_configs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Grants
GRANT ALL ON public.backup_configs       TO service_role;
GRANT ALL ON public.backup_jobs          TO service_role;
GRANT ALL ON public.recovery_jobs        TO service_role;
GRANT ALL ON public.backup_notifications TO service_role;

COMMENT ON TABLE public.backup_configs       IS 'Admin-configured backup schedules per module.';
COMMENT ON TABLE public.backup_jobs          IS 'Immutable log of every backup attempt.';
COMMENT ON TABLE public.recovery_jobs        IS 'Log of every recovery/restore operation.';
COMMENT ON TABLE public.backup_notifications IS 'In-app notifications for backup events.';