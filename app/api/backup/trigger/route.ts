// app/api/backup/trigger/route.ts
import { NextResponse } from 'next/server'
import { runModuleBackup } from '@/lib/backup/engine'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { requireAdmin } from '@/lib/backup/auth-guard'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
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
    const { data: job, error: jobErr } = await db
      .from('backup_jobs')
      .insert({
        module_name,
        backup_type,
        frequency: 'manual' as const,
        status: 'pending',
        triggered_by,
        started_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 })

    // Run backup asynchronously — return job ID immediately
    runModuleBackup({ jobId: job.id, module_name, backup_type })
      .catch(err => console.error(`[Backup] Job ${job.id} failed:`, err))

    return NextResponse.json({
      data: {
        jobId:   job.id,
        status:  'running',
        message: `Backup started for ${module_name}`,
      }
    }, { status: 202 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}