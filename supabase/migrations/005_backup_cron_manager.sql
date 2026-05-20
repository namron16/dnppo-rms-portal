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
  webhook_url TEXT := current_setting('app.backup_webhook_url');
  body_json   TEXT := format('{"frequency":"%s","triggered_by":"scheduler"}', frequency);
BEGIN
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