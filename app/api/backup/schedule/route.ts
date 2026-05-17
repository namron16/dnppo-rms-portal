
import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/gdrive-pool/db'

export const runtime = 'nodejs'

/** GET /api/backup/schedule — get all schedule configs */
export async function GET() {
  const db = getServiceClient()
  const { data, error } = await db
    .from('backup_configs')
    .select('*')
    .order('module_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

/** POST /api/backup/schedule — upsert schedule config for a module */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      module_name, is_enabled, frequency, custom_cron,
      backup_type, include_attachments, encrypt_backup,
      retention_days, destination_path,
    } = body

    const db = getServiceClient()
    const { data, error } = await db
      .from('backup_configs')
      .upsert({
        module_name,
        is_enabled,
        frequency,
        custom_cron: frequency === 'custom' ? custom_cron : null,
        backup_type,
        include_attachments,
        encrypt_backup,
        retention_days,
        destination_path,
        last_configured_by: 'P1',
        last_configured_at: new Date().toISOString(),
      }, { onConflict: 'module_name' })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}