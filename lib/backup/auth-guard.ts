
import { createClient } from '@/lib/supabase/server'

export async function requireP1(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('Unauthenticated')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'P1') {
    throw new Error('Forbidden: Backup operations require P1 (Super Admin) role.')
  }
}

// Usage in API routes:
// import { requireP1 } from '@/lib/backup/auth-guard'
// export async function POST(request: Request) {
//   try { await requireP1() } catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
//   ...
// }