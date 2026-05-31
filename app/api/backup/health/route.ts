// app/api/backup/health/route.ts
import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/gdrive-pool/db'
import { requireAdmin } from '@/lib/backup/auth-guard'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    await requireAdmin()
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }

  try {
    const db = getServiceClient()

    const [summaryRes, recentJobsRes, moduleStatusRes, unreadNotifRes] =
      await Promise.all([
        db.rpc('get_backup_health_summary'),
        db.from('backup_jobs')
          .select('id, module_name, status, backup_type, frequency, started_at, completed_at, total_size_bytes, error_message')
          .order('created_at', { ascending: false })
          .limit(20),
        db.from('backup_configs')
          .select('*'),
        db.from('backup_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('is_read', false),
      ])

    const summary      = (summaryRes.data as any[])?.[0] ?? {}
    const recentJobs   = recentJobsRes.data ?? []
    const moduleStatus = moduleStatusRes.data ?? []
    const unreadCount  = unreadNotifRes.count ?? 0

    return NextResponse.json({
      data: {
        summary,
        recentJobs,
        moduleStatus,
        unreadNotifications: unreadCount,
      }
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}