
-- =============================================================================
-- MIGRATION: 009_fix_backup_cron_utc.sql
-- Fixes pg_cron expressions to use UTC equivalents of PHT backup_hour values.
-- backup_hour column stays as PHT for UI display. The cron expressions are
-- recalculated here for all existing enabled configs.
-- =============================================================================
 
-- Helper: convert PHT hour to UTC hour
CREATE OR REPLACE FUNCTION public.pht_hour_to_utc(pht_hour INT)
RETURNS INT
LANGUAGE sql IMMUTABLE AS $$
  SELECT ((pht_hour - 8) + 24) % 24;
$$;
 
-- Add a generated column that always shows the UTC equivalent
-- (purely informational — the schedule API uses it for logging)
ALTER TABLE public.backup_configs
  ADD COLUMN IF NOT EXISTS backup_hour_utc INT
    GENERATED ALWAYS AS (((backup_hour - 8) + 24) % 24) STORED;
 
-- Re-issue reschedule_backup_cron calls for all currently-enabled configs
-- so their pg_cron jobs use the corrected UTC expressions.
--
-- This runs as a DO block so it processes every enabled row automatically.
-- You do NOT need to manually update each module.
 
DO $$
DECLARE
  rec          RECORD;
  utc_hour     INT;
  cron_expr    TEXT;
  job_name     TEXT;
BEGIN
  FOR rec IN
    SELECT module_name, frequency, backup_hour
    FROM   public.backup_configs
    WHERE  is_enabled = TRUE
      AND  frequency IN ('daily', 'weekly', 'monthly', 'yearly')
  LOOP
    utc_hour := ((rec.backup_hour - 8) + 24) % 24;
 
    CASE rec.frequency
      WHEN 'daily'   THEN
        job_name  := 'rms-daily-backup';
        cron_expr := format('0 %s * * *', utc_hour);
      WHEN 'weekly'  THEN
        job_name  := 'rms-weekly-backup';
        cron_expr := format('0 %s * * 1', utc_hour);
      WHEN 'monthly' THEN
        job_name  := 'rms-monthly-backup';
        cron_expr := format('0 %s 1 * *', utc_hour);
      WHEN 'yearly'  THEN
        job_name  := 'rms-yearly-backup';
        cron_expr := format('0 %s 1 1 *', utc_hour);
      ELSE
        CONTINUE;
    END CASE;
 
    RAISE NOTICE 'Rescheduling % (%): PHT %:00 = UTC %:00 → %',
      rec.module_name, job_name, rec.backup_hour, utc_hour, cron_expr;
 
    PERFORM public.reschedule_backup_cron(job_name, cron_expr, rec.frequency);
  END LOOP;
END $$;
 
GRANT EXECUTE ON FUNCTION public.pht_hour_to_utc(INT) TO service_role;
 
COMMENT ON COLUMN public.backup_configs.backup_hour IS
  'Hour in Philippine Time (PHT = UTC+8) when the backup should run. '
  'Stored as 0–23 PHT. Cron expressions are converted to UTC by the schedule API.';
 
COMMENT ON COLUMN public.backup_configs.backup_hour_utc IS
  'Computed UTC equivalent of backup_hour. Used for cron expression generation. '
  'Do not set directly — it is auto-derived from backup_hour.';
