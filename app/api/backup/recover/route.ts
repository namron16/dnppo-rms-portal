
import { NextResponse } from 'next/server'
import { runRecovery } from '@/lib/backup/recovery'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { backup_job_id, module_name, confirm } = body

    if (!confirm) {
      return NextResponse.json({
        error: 'Recovery requires explicit confirmation. Set confirm: true.'
      }, { status: 400 })
    }

    if (!backup_job_id || !module_name) {
      return NextResponse.json({
        error: 'backup_job_id and module_name are required'
      }, { status: 400 })
    }

    const result = await runRecovery({ backup_job_id, module_name })
    return NextResponse.json({ data: result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}