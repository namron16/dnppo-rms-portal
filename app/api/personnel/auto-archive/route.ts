import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'   // cookie-based, for auth
import { getServiceClient } from '@/lib/gdrive-pool/db' // service-role, for DB writes

function isSeparatedAndExpired(dateOfSeparation?: string | null): boolean {
  if (!dateOfSeparation) return false
  const separated = new Date(dateOfSeparation)
  const threshold = new Date(separated)
  threshold.setFullYear(threshold.getFullYear() + 15)
  return new Date() >= threshold
}

export async function POST(request: Request) {
  // ── Auth: cookie-based server client reads the actual session ─────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile || profile.role !== 'P1') {
    return NextResponse.json({ error: 'Forbidden. Only P1 may trigger auto-archive.' }, { status: 403 })
  }

  // ── Data operations: service-role client bypasses RLS safely ─────────────
  const db = getServiceClient()

  const { data, error } = await db
    .from('personnel_201')
    .select('id, status, date_of_separation')
    .eq('status', 'Separated from Service') // filter server-side, not client-side

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const expiredIds = (data ?? [])
    .filter((r: any) => isSeparatedAndExpired(r.date_of_separation))
    .map((r: any) => r.id)

  if (expiredIds.length === 0) {
    return NextResponse.json({ updated: 0, archivedIds: [] })
  }

  const today = new Date().toISOString().split('T')[0]
  const { error: updateError } = await db
    .from('personnel_201')
    .update({ status: 'Archived', last_updated: today })
    .in('id', expiredIds)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ updated: expiredIds.length, archivedIds: expiredIds })
}