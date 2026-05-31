// app/api/backup/cron/route.ts
//
// FIX-3: backup_hour timezone support.
//
// Problem: Vercel cron (and pg_cron) always run in UTC.
// The admin configures backup_hour in Philippine Time (UTC+8).
// A backup_hour of 2 (2:00 AM PHT) should fire at 18:00 UTC the previous day,
// not 2:00 AM UTC (which is 10:00 AM PHT — completely wrong).
//
// This route is the HTTP receiver called by the Vercel cron or pg_cron webhook.
// It now:
//   1. Reads the current time in PHT (UTC+8) so determineFrequency() correctly
//      identifies the calendar day and day-of-week in local time.
//   2. Compares the CURRENT PHT hour against each enabled module's backup_hour.
//      Only modules whose configured hour matches the current PHT hour are run.
//      This lets different modules fire at different times within the same day
//      without needing separate cron jobs per module.
//
// Vercel cron configuration in vercel.json should run EVERY hour so all
// backup_hour windows can be served:
//   { "crons": [{ "path": "/api/backup/cron", "schedule": "0 * * * *" }] }
//
// If you prefer per-hour crons instead, keep the original schedule and remove
// the backup_hour filtering in runScheduledBackupForHour().

import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { runModuleBackup } from '@/lib/backup/engine'
import type { BackupModuleName } from '@/lib/backup/modules'

export const runtime    = 'nodejs'
export const maxDuration = 300

// Philippine Time offset: UTC+8
const PHT_OFFSET_HOURS = 8

/** Returns the current Date expressed in Philippine Time (UTC+8). */
function nowInPHT(): Date {
  const utcMs  = Date.now()
  const phtMs  = utcMs + PHT_OFFSET_HOURS * 60 * 60 * 1000
  return new Date(phtMs)
}

/**
 * Determines the backup frequency based on the current PHT date.
 * Using PHT ensures Jan 1, Mondays, and the 1st of the month are
 * evaluated in local time, not UTC.
 */
function determineFrequency(
  phtNow: Date
): 'daily' | 'weekly' | 'monthly' | 'yearly' {
  const day   = phtNow.getUTCDay()    // 0=Sun,1=Mon  (phtNow is shifted, so getUTCDay = PHT day)
  const date  = phtNow.getUTCDate()
  const month = phtNow.getUTCMonth()  // 0=Jan

  if (month === 0 && date === 1) return 'yearly'
  if (date === 1)                return 'monthly'
  if (day === 1)                 return 'weekly'
  return 'daily'
}

export async function GET(request: Request) {
  // Validate Vercel cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const phtNow   = nowInPHT()
  const phtHour  = phtNow.getUTCHours()   // hour in PHT (0–23)
  const frequency = determineFrequency(phtNow)

  console.log(
    `[Cron] Fired at UTC ${new Date().toISOString()} ` +
    `= PHT ${phtNow.toISOString().replace('T', ' ').slice(0, 16)} ` +
    `(hour=${phtHour}, frequency=${frequency})`
  )

  const result = await runScheduledBackupForHour({
    frequency,
    phtHour,
    triggeredBy: 'system',
  })

  return NextResponse.json({ data: result })
}

/**
 * Runs all enabled modules whose configured backup_hour matches the current
 * PHT hour AND whose frequency matches the calendar-derived frequency.
 *
 * This replaces the original runScheduledBackup() call so the engine only
 * activates the modules the admin scheduled for THIS hour.
 */
async function runScheduledBackupForHour(opts: {
  frequency:   'daily' | 'weekly' | 'monthly' | 'yearly'
  phtHour:     number
  triggeredBy: string
}) {
  const db = getServiceClient()

  // Fetch all enabled configs that match the frequency AND the current PHT hour.
  // backup_hour stores the admin's intended PHT hour (0–23).
  // If backup_hour is NULL (legacy rows), default to 2 (2:00 AM PHT).
  const { data: configs, error } = await db
    .from('backup_configs')
    .select('*')
    .eq('is_enabled', true)
    .eq('frequency', opts.frequency)

  if (error) {
    console.error('[Cron] Failed to fetch backup_configs:', error.message)
    return { started: 0, results: [] }
  }

  if (!configs || configs.length === 0) {
    console.log(`[Cron] No enabled configs for frequency: ${opts.frequency}`)
    return { started: 0, results: [] }
  }

  // Filter to only the modules whose configured hour matches NOW in PHT.
  // Modules with no backup_hour set default to 2 (original system default).
  const dueConfigs = configs.filter(config => {
    const configuredHour = config.backup_hour ?? 2
    const isDue          = configuredHour === opts.phtHour
    if (!isDue) {
      console.log(
        `[Cron] Skipping ${config.module_name} — scheduled for ` +
        `${configuredHour}:00 PHT, current PHT hour is ${opts.phtHour}`
      )
    }
    return isDue
  })

  if (dueConfigs.length === 0) {
    console.log(
      `[Cron] No modules due at PHT hour ${opts.phtHour} ` +
      `for frequency=${opts.frequency}`
    )
    return { started: 0, results: [] }
  }

  console.log(
    `[Cron] Running ${dueConfigs.length} module(s) due at ` +
    `PHT ${opts.phtHour}:00 (frequency=${opts.frequency}): ` +
    dueConfigs.map(c => c.module_name).join(', ')
  )

  const results = await Promise.allSettled(
    dueConfigs.map(async (config) => {
      const { data: job, error: jobErr } = await db
        .from('backup_jobs')
        .insert({
          config_id:    config.id,
          module_name:  config.module_name,
          backup_type:  config.backup_type ?? 'full',
          frequency:    opts.frequency,
          status:       'pending',
          triggered_by: opts.triggeredBy,
          started_at:   new Date().toISOString(),
        })
        .select()
        .single()

      if (jobErr || !job) {
        console.error(
          `[Cron] Could not create job for ${config.module_name}:`,
          jobErr?.message
        )
        return { success: false, jobId: '', folderName: '', fileCount: 0,
                 totalBytes: 0, durationSecs: 0, manifestChecksum: '',
                 error: jobErr?.message ?? 'Job insert failed' }
      }

      return runModuleBackup({
        jobId:       job.id,
        module_name: config.module_name as BackupModuleName,
        backup_type: config.backup_type ?? 'full',
      })
    })
  )

  const settled = results.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : { success: false, error: String((r as any).reason) }
  )

  const succeeded = settled.filter(r => r.success).length
  console.log(`[Cron] Completed: ${succeeded}/${dueConfigs.length} succeeded`)

  return { started: dueConfigs.length, results: settled }
}