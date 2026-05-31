// app/api/backup/cron/route.ts
//
// FIX-3: backup_hour timezone support.
// Enhanced: all errors now include structured codes and contextual detail
// so you can immediately tell WHAT failed and WHERE in the pipeline.

import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { runModuleBackup } from '@/lib/backup/engine'
import type { BackupModuleName } from '@/lib/backup/modules'

export const runtime     = 'nodejs'
export const maxDuration = 300

const PHT_OFFSET_HOURS = 8

function nowInPHT(): Date {
  const utcMs = Date.now()
  const phtMs = utcMs + PHT_OFFSET_HOURS * 60 * 60 * 1000
  return new Date(phtMs)
}

function determineFrequency(
  phtNow: Date
): 'daily' | 'weekly' | 'monthly' | 'yearly' {
  const day   = phtNow.getUTCDay()
  const date  = phtNow.getUTCDate()
  const month = phtNow.getUTCMonth()

  if (month === 0 && date === 1) return 'yearly'
  if (date === 1)                return 'monthly'
  if (day === 1)                 return 'weekly'
  return 'daily'
}

export async function GET(request: Request) {
  // ── Auth: validate Vercel cron secret ──────────────────────────────────────
  const authHeader = request.headers.get('authorization')

  if (!process.env.CRON_SECRET) {
    console.error('[Cron] CRON_SECRET env var is not set. Set it in Vercel Environment Variables.')
    return NextResponse.json({
      error:  'Server misconfiguration: CRON_SECRET is not set.',
      code:   'MISSING_CRON_SECRET',
      detail: 'Add CRON_SECRET to your Vercel environment variables and redeploy.',
    }, { status: 500 })
  }

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn(
      `[Cron] Unauthorized request. ` +
      `Expected Bearer <CRON_SECRET>, got: ${authHeader?.slice(0, 20) ?? '(empty)'}…`
    )
    return NextResponse.json({
      error:  'Unauthorized. Invalid or missing CRON_SECRET.',
      code:   'UNAUTHORIZED',
      detail: 'Ensure the Authorization header is set to "Bearer <CRON_SECRET>".',
    }, { status: 401 })
  }

  const phtNow    = nowInPHT()
  const phtHour   = phtNow.getUTCHours()
  const frequency = determineFrequency(phtNow)

  console.log(
    `[Cron] Fired at UTC ${new Date().toISOString()} ` +
    `= PHT ${phtNow.toISOString().replace('T', ' ').slice(0, 16)} ` +
    `(hour=${phtHour}, frequency=${frequency})`
  )

  try {
    const result = await runScheduledBackupForHour({
      frequency,
      phtHour,
      triggeredBy: 'system',
    })
    return NextResponse.json({ data: result })
  } catch (err: any) {
    const msg = err?.message ?? String(err)
    console.error('[Cron] runScheduledBackupForHour threw unexpectedly:', msg)
    return NextResponse.json({
      error:  'Cron handler threw an unhandled error.',
      code:   'CRON_HANDLER_ERROR',
      detail: msg,
    }, { status: 500 })
  }
}

async function runScheduledBackupForHour(opts: {
  frequency:   'daily' | 'weekly' | 'monthly' | 'yearly'
  phtHour:     number
  triggeredBy: string
}) {
  const db = getServiceClient()

  // ── Fetch matching configs ─────────────────────────────────────────────────
  const { data: configs, error: configsError } = await db
    .from('backup_configs')
    .select('*')
    .eq('is_enabled', true)
    .eq('frequency', opts.frequency)

  if (configsError) {
    const detail = [
      `code=${configsError.code}`,
      `message=${configsError.message}`,
      `hint=${configsError.hint ?? 'none'}`,
      `details=${configsError.details ?? 'none'}`,
    ].join(', ')

    console.error(`[Cron] backup_configs fetch failed: ${detail}`)

    // Surface as a structured error so the caller can log it properly
    throw new Error(
      `Failed to fetch backup_configs from Supabase. ` +
      `This usually means the table does not exist (run migration 004) ` +
      `or SUPABASE_SERVICE_ROLE_KEY is wrong. Detail: ${detail}`
    )
  }

  if (!configs || configs.length === 0) {
    console.log(
      `[Cron] No enabled configs for frequency="${opts.frequency}". ` +
      `Either all modules are disabled or none have been configured yet ` +
      `(open Backup Schedule settings to configure them).`
    )
    return { started: 0, results: [] }
  }

  // ── Filter to modules due NOW ──────────────────────────────────────────────
  const dueConfigs = configs.filter(config => {
    const configuredHour = config.backup_hour ?? 2
    const isDue          = configuredHour === opts.phtHour
    if (!isDue) {
      console.log(
        `[Cron] Skipping "${config.module_name}" — ` +
        `scheduled for ${configuredHour}:00 PHT, current PHT hour is ${opts.phtHour}`
      )
    }
    return isDue
  })

  if (dueConfigs.length === 0) {
    console.log(
      `[Cron] No modules due at PHT ${opts.phtHour}:00 for frequency="${opts.frequency}". ` +
      `Modules are configured but none match the current hour. ` +
      `Check backup_hour values in the Schedule settings.`
    )
    return { started: 0, results: [] }
  }

  console.log(
    `[Cron] Running ${dueConfigs.length} module(s) at PHT ${opts.phtHour}:00 ` +
    `(frequency=${opts.frequency}): ${dueConfigs.map(c => c.module_name).join(', ')}`
  )

  // ── Create job records and run backups ─────────────────────────────────────
  const results = await Promise.allSettled(
    dueConfigs.map(async (config) => {
      // Create job row
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
        const detail = jobErr
          ? `code=${jobErr.code}, message=${jobErr.message}, hint=${jobErr.hint ?? 'none'}`
          : 'insert returned no row'

        console.error(
          `[Cron] Could not create backup_jobs row for module "${config.module_name}". ` +
          `Check RLS on backup_jobs and that service role key is correct. Detail: ${detail}`
        )

        return {
          success: false,
          jobId: '',
          folderName: '',
          fileCount: 0,
          totalBytes: 0,
          durationSecs: 0,
          manifestChecksum: '',
          error: `Job insert failed for "${config.module_name}": ${detail}`,
        }
      }

      return runModuleBackup({
        jobId:       job.id,
        module_name: config.module_name as BackupModuleName,
        backup_type: config.backup_type ?? 'full',
      })
    })
  )

  const settled = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value

    const reason = String((r as PromiseRejectedResult).reason)
    console.error(
      `[Cron] Module "${dueConfigs[i]?.module_name}" rejected unexpectedly: ${reason}`
    )
    return {
      success: false,
      error: `Unhandled rejection for "${dueConfigs[i]?.module_name}": ${reason}`,
    }
  })

  const succeeded = settled.filter(r => r.success).length
  console.log(`[Cron] Completed: ${succeeded}/${dueConfigs.length} succeeded`)

  return { started: dueConfigs.length, results: settled }
}