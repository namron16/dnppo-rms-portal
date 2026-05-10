
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient }  from '@supabase/supabase-js'

// Admin client with service role — bypasses RLS
function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Get the calling user's role to ensure only 'admin' can call these actions
async function assertSuperAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') throw new Error('Forbidden')
}

// ── List all users ──────────────────────────

export async function listAllUsers() {
  await assertSuperAdmin()
  const admin = getAdminClient()

  const { data, error } = await admin.auth.admin.listUsers()
  if (error) throw error

  // Enrich with profiles
  const supabase = await createServerClient()
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, role, display_name, is_active')

  const profileMap = Object.fromEntries(
    (profiles ?? []).map(p => [p.id, p])
  )

  return data.users.map(u => ({
    id:          u.id,
    email:       u.email,
    lastSignIn:  u.last_sign_in_at,
    createdAt:   u.created_at,
    role:        profileMap[u.id]?.role        ?? 'unknown',
    displayName: profileMap[u.id]?.display_name ?? u.email,
    isActive:    profileMap[u.id]?.is_active    ?? true,
  }))
}

// ── Toggle active status ──────────────────────

export async function setUserActive(userId: string, isActive: boolean) {
  await assertSuperAdmin()
  const supabase = await createServerClient()

  const { error } = await supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)

  if (error) throw error

  // If deactivating, also sign them out everywhere
  if (!isActive) {
    const admin = getAdminClient()
    await admin.auth.admin.signOut(userId, 'global')
  }
}

// ── Reset a user's password ─────────────────

export async function adminResetPassword(userId: string, newPassword: string) {
  await assertSuperAdmin()

  if (newPassword.length < 12) throw new Error('Password must be at least 12 characters.')

  const admin = getAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
  if (error) throw error
}