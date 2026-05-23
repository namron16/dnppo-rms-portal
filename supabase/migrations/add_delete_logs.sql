-- Run daily, delete logs older than 90 days
SELECT cron.schedule(
  'delete-old-logs',
  '0 0 * * *',        -- every midnight
  $$
    DELETE FROM admin_logs
    WHERE created_at < NOW() - INTERVAL '90 days';
  $$
);