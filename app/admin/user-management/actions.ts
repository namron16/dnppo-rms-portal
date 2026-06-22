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

// ── Fetch a single user by ID ─────────────────────────────────────────────

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

export async function setUserActive(userId: string, isActive: boolean) {
  await assertSuperAdmin()

  const admin = getAdminClient()

  // 1. Source of truth: profiles table (must use admin client to bypass RLS)
  const { error: profileError } = await admin
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)

  if (profileError) throw profileError

  // 2. Sync into user_metadata for middleware checks
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

  // 3. Invalidate all sessions when deactivating
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

// ── Create a brand-new account ────────────────────────────────────────────

export async function createAccount(input: {
  email:        string
  password:     string
  role:         string
  display_name: string
  title:        string
  initials:     string
  avatar_color: string
  nav_group:    'documents' | 'admin' | 'dpda-dpdo'
  can_upload:   boolean
  is_viewer_only: boolean
}) {
  await assertSuperAdmin()

  const admin = getAdminClient()

  // 1. Register the role in role_registry
  const { error: roleError } = await admin.rpc('register_role', {
    p_role:           input.role,
    p_display_name:   input.display_name,
    p_title:          input.title,
    p_nav_group:      input.nav_group,
    p_default_route:  '/admin/master',
    p_can_upload:     input.can_upload,
    p_is_viewer_only: input.is_viewer_only,
    p_sort_order:     100,
    p_created_by:     'admin',
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

// ── Delete account ────────────────────────────────────────────────────────
//
// Logging note: this runs server-side with the service role key, so the
// browser-side adminLogger (which relies on auth.getUser()) cannot be used.
// Instead we write directly to admin_logs using the admin client, using
// 'admin' as the role (the only role that can reach this action).
// The log entry is written AFTER all destructive steps succeed so a failed
// deletion is never recorded as complete.

export async function deleteAccount(userId: string, role: string) {
  await assertSuperAdmin()

  const admin = getAdminClient()

  // Guard: never allow deleting built-in protected accounts
  const PROTECTED_ROLES = ['admin', 'PD']
  if (PROTECTED_ROLES.includes(role)) {
    throw new Error(`The "${role}" account is protected and cannot be deleted.`)
  }

  // 1. Fetch the profile first so we have the display name for the log
  const { data: profile } = await admin
    .from('profiles')
    .select('role, display_name')
    .eq('id', userId)
    .single()

  const displayName = profile?.display_name ?? role

  // 2. Delete from Supabase Auth (cascades to profile row if trigger exists)
  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId)
  if (authDeleteError) throw new Error(`Auth deletion failed: ${authDeleteError.message}`)

  // 3. Delete profile row (safe even if cascade already removed it)
  await admin.from('profiles').delete().eq('id', userId)

  // 4. Remove from Drive pool users table
  await admin.from('users').delete().eq('username', role)

  // 5. Soft-delete the role in registry (preserves display names in log history)
  const { error: registryError } = await admin.rpc('deactivate_role', { p_role: role })
  if (registryError) throw new Error(`Registry deactivation failed: ${registryError.message}`)

  // 6. Write audit log — only after all destructive steps succeed.
  //    We resolve the acting admin's user_id from the current session so the
  //    log row satisfies the RLS policy (user_id must match auth.uid()).
  //    The service role client bypasses RLS, so this insert always lands.
  const supabase = await createServerClient()
  const { data: { user: actingUser } } = await supabase.auth.getUser()

  await admin.from('admin_logs').insert({
    // Use the acting admin's real user_id so the log is attributable.
    // Fall back to the deleted user's id only as a last resort (should never happen).
    user_id:     actingUser?.id ?? userId,
    role:        'admin',
    action:      'delete_account',
    description: `Deleted account: ${displayName} (${role})`,
  })

  return { success: true }
}