CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS void
LANGUAGE sql
SECURITY DEFINER  -- runs with DB owner privileges, bypasses RLS
AS $$
  DELETE FROM public.active_sessions
  WHERE logged_in_at < NOW() - INTERVAL '24 hours';
$$;



SELECT cron.schedule(
  'cleanup-expired-sessions',         -- job name (must be unique)
  '0 * * * *',                        -- cron expression: every hour
  'SELECT public.cleanup_expired_sessions()'
);


-- Pause without deleting
UPDATE cron.job SET active = false WHERE jobname = 'cleanup-expired-sessions';

-- Delete permanently
SELECT cron.unschedule('cleanup-expired-sessions');