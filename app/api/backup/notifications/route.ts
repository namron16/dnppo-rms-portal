import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/gdrive-pool/db'

export const runtime = 'nodejs'

export async function GET() {
  const db = getServiceClient()
  const { data, error } = await db
    .from('backup_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function PATCH(request: Request) {
  const { ids } = await request.json()
  const db = getServiceClient()

  await db.from('backup_notifications')
    .update({ is_read: true })
    .in('id', ids)

  return NextResponse.json({ data: { success: true } })
}