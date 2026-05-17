
import { getServiceClient } from '@/lib/gdrive-pool/db'

interface NotifyParams {
  jobId:       string
  module_name: string
  success:     boolean
  folderName?: string
  durationSecs?: number
  totalBytes?:   number
  error?:        string
}

export async function notifyBackupResult(params: NotifyParams): Promise<void> {
  const db = getServiceClient()

  const type    = params.success ? 'success' : 'failure'
  const sizeStr = params.totalBytes
    ? `(${(params.totalBytes / 1024 / 1024).toFixed(1)} MB)`
    : ''

  const title = params.success
    ? `✅ Backup Completed — ${params.module_name}`
    : `❌ Backup Failed — ${params.module_name}`

  const message = params.success
    ? `Backup "${params.folderName}" completed in ${params.durationSecs}s ${sizeStr}`
    : `Backup failed: ${params.error ?? 'Unknown error'}`

  await db.from('backup_notifications').insert({
    backup_job_id: params.jobId,
    type,
    title,
    message,
  })

  // Optionally send email notification if SMTP is configured
  if (process.env.SMTP_HOST && !params.success) {
    await sendEmailAlert({ title, message })
  }
}

async function sendEmailAlert(params: { title: string; message: string }): Promise<void> {
  // Implement using nodemailer or Resend API
  // process.env.BACKUP_ALERT_EMAIL = 'sysadmin@dnppo.pnp.gov.ph'
  console.log(`[Backup Email Alert] ${params.title}: ${params.message}`)
}