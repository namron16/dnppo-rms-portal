ALTER DATABASE postgres
  SET app.backup_webhook_url = 'https://your-rms-domain.vercel.app/api/backup/cron';