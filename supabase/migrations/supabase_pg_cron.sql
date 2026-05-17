-- Enable pg_cron in Supabase dashboard (Database > Extensions > pg_cron)

-- Daily backup — triggers at 2:00 AM every day
SELECT cron.schedule(
  'rms-daily-backup',
  '0 2 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.backup_webhook_url'),
    body := '{"frequency":"daily","triggered_by":"scheduler"}'::jsonb
  )$$
);

-- Weekly backup
SELECT cron.schedule(
  'rms-weekly-backup',
  '0 2 * * 1',
  $$SELECT net.http_post(
    url := current_setting('app.backup_webhook_url'),
    body := '{"frequency":"weekly","triggered_by":"scheduler"}'::jsonb
  )$$
);

-- Monthly backup
SELECT cron.schedule(
  'rms-monthly-backup',
  '0 2 1 * *',
  $$SELECT net.http_post(
    url := current_setting('app.backup_webhook_url'),
    body := '{"frequency":"monthly","triggered_by":"scheduler"}'::jsonb
  )$$
);

-- Yearly backup
SELECT cron.schedule(
  'rms-yearly-backup',
  '0 2 1 1 *',
  $$SELECT net.http_post(
    url := current_setting('app.backup_webhook_url'),
    body := '{"frequency":"yearly","triggered_by":"scheduler"}'::jsonb
  )$$
);