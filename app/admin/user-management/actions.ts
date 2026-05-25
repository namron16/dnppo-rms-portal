'use server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient }  from '@supabase/supabase-js'

// ── Admin client (service role — bypasses RLS) ────────────────────────────

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ── Guard: only 'admin' role may call these actions ───────────────────────

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

// ── List ALL users (initial load only) ───────────────────────────────────

export async function listAllUsers() {
  await assertSuperAdmin()

  const admin = getAdminClient()
  const { data, error } = await admin.auth.admin.listUsers()
  if (error) throw error

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
    role:        profileMap[u.id]?.role         ?? 'unknown',
    displayName: profileMap[u.id]?.display_name ?? u.email,
    isActive:    profileMap[u.id]?.is_active     ?? true,
  }))
}

// ── Fetch a single user by ID (used by realtime patch callbacks) ──────────
// Returns null when the user no longer exists (deleted edge case).

export async function getSingleUser(userId: string) {
  await assertSuperAdmin()

  const admin = getAdminClient()

  const { data: authUser, error } = await admin.auth.admin.getUserById(userId)
  if (error) return null

  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, display_name, is_active, initials, avatar_color, title')
    .eq('id', userId)
    .single()

  const u = authUser.user
  return {
    id:          u.id,
    email:       u.email,
    lastSignIn:  u.last_sign_in_at,
    createdAt:   u.created_at,
    role:        profile?.role         ?? 'unknown',
    displayName: profile?.display_name ?? u.email,
    isActive:    profile?.is_active     ?? true,
    initials:    profile?.initials      ?? (profile?.role ?? 'UN').slice(0, 2).toUpperCase(),
    avatarColor: profile?.avatar_color  ?? '#6b7280',
    title:       profile?.title         ?? undefined,
  }
}

// ── Toggle active/inactive ─────────────────────────────────────────────────
//
// Order of operations matters here:
//
//   1. Update profiles.is_active  — source of truth for the UI + realtime
//   2. Update user_metadata       — what the middleware JWT check reads
//   3. Global sign-out            — invalidate all existing sessions
//
// Steps 2 and 3 must happen in this order. If we sign out first, the user's
// JWT is revoked before the metadata is updated, so the middleware still sees
// the OLD is_active value on any in-flight request, allowing a brief window
// where the account is signed out but the middleware would re-admit them.
// Writing metadata first closes that window completely.

export async function setUserActive(userId: string, isActive: boolean) {
  await assertSuperAdmin()

  const supabase = await createServerClient()
  const admin    = getAdminClient()

  // 1. Source of truth: profiles table
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)

  if (profileError) throw profileError

  // 2. Sync into user_metadata for middleware checks
  //    Fetch the current metadata first so we don't wipe other fields.
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

  // 3. Immediately invalidate all sessions when deactivating.
  //    A small pause ensures Supabase has propagated the metadata update
  //    to its internal token-validation layer before the sessions are killed.
  //    Without this, a racing token refresh on the client can produce a new
  //    JWT that still carries is_active: true.
  if (!isActive) {
    await new Promise(r => setTimeout(r, 150))
    await admin.auth.admin.signOut(userId, 'global')
  }
}

// ── Reset password ─────────────────────────────────────────────────────────

export async function adminResetPassword(userId: string, newPassword: string) {
  await assertSuperAdmin()

  if (newPassword.length < 8) throw new Error('Password must be at least 8 characters.')

  const admin = getAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
  if (error) throw error
}

// ── Update email address ───────────────────────────────────────────────────

export async function adminUpdateEmail(
  userId: string,
  newEmail: string,
  options?: { sendConfirmation?: boolean }
) {
  await assertSuperAdmin()

  if (!newEmail.includes('@')) throw new Error('Invalid email address.')

  const admin = getAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, {
    email:         newEmail,
    email_confirm: !(options?.sendConfirmation ?? false),
  })

  if (error) throw error
}