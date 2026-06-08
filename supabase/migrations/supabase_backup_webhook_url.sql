-- App-wide configuration table
CREATE TABLE IF NOT EXISTS public.app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed the backup webhook URL
INSERT INTO public.app_config (key, value)
VALUES ('backup_webhook_url', 'https://11dnppo-rms.com/api/backup/cron')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;