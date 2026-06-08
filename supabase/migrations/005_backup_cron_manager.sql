-- supabase/migrations/005_backup_cron_manager.sql

CREATE OR REPLACE FUNCTION public.reschedule_backup_cron(
  job_name   TEXT,    -- e.g. 'rms-daily-backup'
  new_cron   TEXT,    -- e.g. '0 3 * * *' for 3AM
  frequency  TEXT     -- 'daily' | 'weekly' | 'monthly' | 'yearly'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  webhook_url TEXT;
  body_json   TEXT := format('{"frequency":"%s","triggered_by":"scheduler"}', frequency);
BEGIN
  -- Read webhook URL from config table
  SELECT value INTO webhook_url
  FROM public.app_config
  WHERE key = 'backup_webhook_url';

  -- Safety check: abort if URL is missing
  IF webhook_url IS NULL THEN
    RAISE EXCEPTION 'backup_webhook_url is not set in app_config table';
  END IF;

  -- Remove existing job if it exists
  PERFORM cron.unschedule(job_name);

  -- Re-create with new cron expression
  PERFORM cron.schedule(
    job_name,
    new_cron,
    format(
      $sql$SELECT net.http_post(url := %L, body := %L::jsonb)$sql$,
      webhook_url,
      body_json
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reschedule_backup_cron(TEXT, TEXT, TEXT) TO service_role;