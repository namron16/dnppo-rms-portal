// app/api/backup/recover/route.ts
import { NextResponse } from 'next/server'
import { runRecovery } from '@/lib/backup/recovery'
import { requireAdmin } from '@/lib/backup/auth-guard'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  // Only the Super Admin (admin role) may trigger a recovery
  let adminUser: { id: string; role: string } | null = null

  try {
    await requireAdmin()

    // Also grab the calling user so we can pass triggered_by correctly
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      adminUser = { id: user.id, role: profile?.role ?? 'admin' }
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }

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

    // Pass triggered_by so recovery.ts uploads files to the correct Drive pool
    const result = await runRecovery({
      backup_job_id,
      module_name,
      triggered_by: adminUser?.role ?? 'admin',
    })

    return NextResponse.json({ data: result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}