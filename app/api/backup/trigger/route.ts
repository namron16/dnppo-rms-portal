// app/api/backup/trigger/route.ts
//
// POST — manually triggers a backup for one module.
//
// Changes vs original:
//   • Checks backup_configs.is_enabled before starting.
//     If the module is disabled, returns 403 with a clear message.
//     This ensures the disable toggle in ScheduleModal also blocks
//     manual backups, not just scheduled ones.

import { NextResponse } from 'next/server'
import { runModuleBackup } from '@/lib/backup/engine'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { requireAdmin } from '@/lib/backup/auth-guard'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  try {
    await requireAdmin()
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { module_name, backup_type = 'full', triggered_by = 'admin' } = body

    if (!module_name) {
      return NextResponse.json({ error: 'module_name is required' }, { status: 400 })
    }

    const db = getServiceClient()

    // ── NEW: Check is_enabled before allowing a manual backup ─────────────
    //
    // The original trigger route accepted any module_name and started
    // immediately, bypassing the is_enabled flag in backup_configs.
    // This check makes the disable toggle apply to manual backups too.
    //
    // maybeSingle() is used because a config row may not exist yet for a
    // module (the module exists in code but hasn't been configured via the UI).
    // In that case we allow the backup to proceed — absence of a config
    // row does not mean the module is disabled, it just hasn't been touched.
    const { data: config, error: configErr } = await db
      .from('backup_configs')
      .select('is_enabled')
      .eq('module_name', module_name)
      .maybeSingle()

    if (configErr) {
      // Non-fatal: if the config lookup fails we still allow the backup.
      // Log the error but do not block.
      console.warn(`[Trigger] Could not read backup_config for ${module_name}:`, configErr.message)
    }

    // config exists AND is explicitly disabled → block
    if (config !== null && config.is_enabled === false) {
      return NextResponse.json(
        {
          error: `Backups for "${module_name}" are currently disabled. `
            + `Enable the module in Backup Schedule settings before triggering manually.`,
        },
        { status: 403 }
      )
    }

    // ── Create pending job record ─────────────────────────────────────────
    const { data: job, error: jobErr } = await db
      .from('backup_jobs')
      .insert({
        module_name,
        backup_type,
        frequency:    'manual' as const,
        status:       'pending',
        triggered_by,
        started_at:   new Date().toISOString(),
      })
      .select()
      .single()

    if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 })

    // ── Run backup asynchronously — return job ID immediately ─────────────
    // We intentionally do NOT await so the HTTP response returns fast.
    // The client polls /api/backup/jobs/[id] or /api/backup/health for status.
    runModuleBackup({ jobId: job.id, module_name, backup_type })
      .catch(err => console.error(`[Backup] Job ${job.id} failed:`, err))

    return NextResponse.json(
      {
        data: {
          jobId:   job.id,
          status:  'running',
          message: `Backup started for ${module_name}`,
        },
      },
      { status: 202 }
    )
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}