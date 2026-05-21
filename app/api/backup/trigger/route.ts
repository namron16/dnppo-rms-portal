// app/api/backup/trigger/route.ts
//
// POST — manually triggers a backup for one module.
//
// Changes vs original:
//   • triggered_by is now derived from the authenticated session (profile.role)
//     instead of being read from the request body. This means the backup_jobs
//     log always reflects who actually triggered the backup, not what the client
//     claimed. The body field is ignored if sent.
//   • Checks backup_configs.is_enabled before starting. If the module is
//     disabled, returns 403 with a clear message.

import { NextResponse } from 'next/server'
import { runModuleBackup } from '@/lib/backup/engine'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { requireAdmin } from '@/lib/backup/auth-guard'
import { createClient } from '@/lib/supabase/server'

export const runtime    = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  try {
    await requireAdmin()
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }

  // FIX: derive triggered_by from the authenticated session instead of trusting
  // whatever the client sends in the body. Defaults to 'admin' if the profile
  // lookup fails for any reason.
  let triggeredBy = 'admin'
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (profile?.role) triggeredBy = profile.role
    }
  } catch {
    // Non-fatal — fall back to 'admin'
  }

  try {
    const body = await request.json()
    // triggered_by is intentionally NOT read from body — see comment above
    const { module_name, backup_type = 'full' } = body

    if (!module_name) {
      return NextResponse.json({ error: 'module_name is required' }, { status: 400 })
    }

    const db = getServiceClient()

    // ── Check is_enabled before allowing a manual backup ──────────────────
    // maybeSingle() because a config row may not exist yet for a module that
    // hasn't been configured via the UI. Absence of a config row means the
    // module hasn't been explicitly disabled — allow the backup to proceed.
    const { data: config, error: configErr } = await db
      .from('backup_configs')
      .select('is_enabled')
      .eq('module_name', module_name)
      .maybeSingle()

    if (configErr) {
      console.warn(`[Trigger] Could not read backup_config for ${module_name}:`, configErr.message)
    }

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
        triggered_by: triggeredBy,  // FIX: from session, not body
        started_at:   new Date().toISOString(),
      })
      .select()
      .single()

    if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 })

    // ── Run backup asynchronously — return job ID immediately ─────────────
    // We intentionally do NOT await so the HTTP response returns fast.
    // The client polls /api/backup/health for status updates.
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