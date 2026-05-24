
'use server'
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

  // ✅ FIX 1 — use admin client to bypass RLS when reading all profiles
  const { data: profiles } = await admin
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
  const admin    = getAdminClient()

  // 1. Update profiles table (source of truth for the UI)
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)

  if (profileError) throw profileError

  // 2. Sync into user_metadata so the middleware can check without a DB call.
  //    We merge so we don't accidentally wipe other keys (e.g. role).
  const { data: authUser, error: fetchError } = await admin.auth.admin.getUserById(userId)
  if (fetchError) throw fetchError

  const merged = {
    ...(authUser.user?.user_metadata ?? {}),
    is_active: isActive,
  }

  const { error: metaError } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: merged,
  })
  if (metaError) throw metaError

  // 3. If deactivating, immediately invalidate all existing sessions
  if (!isActive) {
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

// ── Update email address ────────────────────────────────────────────

/**
 * Update a user's email address.
 * Only callable by a user with role = 'admin'.
 * Pass sendConfirmation: false to skip confirmation email (for internal accounts).
 */
export async function adminUpdateEmail(
  userId: string,
  newEmail: string,
  options?: { sendConfirmation?: boolean }
) {
  await assertSuperAdmin()

  if (!newEmail.includes('@')) {
    throw new Error('Invalid email address.')
  }

  const admin = getAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, {
    email: newEmail,
    email_confirm: !(options?.sendConfirmation ?? false),
  })

  if (error) throw error
}