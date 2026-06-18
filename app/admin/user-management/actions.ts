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
//
// FIX: Step 1 now uses the admin client (service role) instead of the regular
// server client. The regular client is subject to RLS, and the profiles RLS
// policy only allows users to update their OWN row — so an admin trying to
// update someone else's profile would be silently blocked (no error thrown,
// nothing saved). The admin client bypasses RLS entirely, ensuring the
// is_active change is actually persisted to the database.

export async function setUserActive(userId: string, isActive: boolean) {
  await assertSuperAdmin()

  const admin = getAdminClient()

  // 1. Source of truth: profiles table
  //    Must use the admin client here — the regular server client is bound by
  //    RLS, which only permits a user to UPDATE their own profile row.
  //    Using it to update another user's row would silently no-op (0 rows
  //    affected, no error), causing the button to reset on page refresh.
  const { error: profileError } = await admin
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)

  if (profileError) throw profileError

  // 2. Sync into user_metadata for middleware checks.
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


// ── Create a brand-new account (role + auth user + profile + drive slot) ──────

export async function createAccount(input: {
  email:        string
  password:     string
  role:         string          // e.g. 'P11', 'FINANCE'
  display_name: string
  title:        string
  initials:     string
  avatar_color: string
  nav_group:    'documents' | 'admin' | 'dpda'
  can_upload:   boolean
  is_viewer_only: boolean
}) {
  await assertSuperAdmin()

  const admin = getAdminClient()

  // 1. Register the role in role_registry
  const { error: roleError } = await admin.rpc('register_role', {
    p_role:          input.role,
    p_display_name:  input.display_name,
    p_title:         input.title,
    p_nav_group:     input.nav_group,
    p_default_route: '/admin/master',
    p_can_upload:    input.can_upload,
    p_is_viewer_only: input.is_viewer_only,
    p_sort_order:    100,
    p_created_by:    'admin',
  })
  if (roleError) throw new Error(`Role registration failed: ${roleError.message}`)

  // 2. Create the Supabase auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email:         input.email,
    password:      input.password,
    email_confirm: true,
    user_metadata: { role: input.role, is_active: true },
  })
  if (authError) throw new Error(`Auth user creation failed: ${authError.message}`)

  const userId = authData.user.id

  // 3. Insert profile row
  const { error: profileError } = await admin
    .from('profiles')
    .insert({
      id:           userId,
      role:         input.role,
      display_name: input.display_name,
      title:        input.title,
      initials:     input.initials,
      avatar_color: input.avatar_color,
      is_active:    true,
    })
  if (profileError) throw new Error(`Profile creation failed: ${profileError.message}`)

  // 4. Seed Drive pool users table
  await admin
    .from('users')
    .upsert({ username: input.role, role: 'USER' }, { onConflict: 'username' })

  return { userId }
}

//delete account (auth user + profile + drive slot + role registry entry)
export async function deleteAccount(userId: string, role: string) {
  await assertSuperAdmin()

  const admin = getAdminClient()

  // Guard: never allow deleting the built-in admin account
  const PROTECTED_ROLES = ['admin', 'PD']
  if (PROTECTED_ROLES.includes(role)) {
    throw new Error(`The "${role}" account is protected and cannot be deleted.`)
  }

  // 1. Get the profile before deletion so we can log it
  const { data: profile } = await admin
    .from('profiles')
    .select('role, display_name')
    .eq('id', userId)
    .single()

  // 2. Delete from Supabase Auth — this is the primary deletion
  //    If your DB has an ON DELETE CASCADE trigger on profiles.id → auth.users.id,
  //    the profile row will be removed automatically. Otherwise step 3 handles it.
  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId)
  if (authDeleteError) throw new Error(`Auth deletion failed: ${authDeleteError.message}`)

  // 3. Delete profile row (safe to call even if cascade already removed it)
  await admin.from('profiles').delete().eq('id', userId)

  // 4. Remove from Drive pool users table
  await admin.from('users').delete().eq('username', role)

  // 5. Soft-delete the role in registry (keeps log history display names intact)
  const { error: registryError } = await admin.rpc('deactivate_role', { p_role: role })
  if (registryError) throw new Error(`Registry deactivation failed: ${registryError.message}`)

  // 6. Log the deletion in admin_logs for the audit trail
  await admin.from('admin_logs').insert({
    user_id:     userId,
    role:        'admin',
    action:      'delete_account',
    description: `Deleted account: ${profile?.display_name ?? role} (${role})`,
  })

  return { success: true }
}