// app/admin/user-management/actions.ts
'use server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient }  from '@supabase/supabase-js'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ── Guard: only accounts with nav_group='admin' in role_registry may call these
// FIX: no longer checks role === 'admin' (hardcoded string).
// Instead checks nav_group from role_registry, so any dynamically created
// admin-group account (e.g. 'DN', 'SYSADMIN') can manage users too.

async function assertSuperAdmin() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')

  // Read the role from the profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile?.role) throw new Error('Forbidden')

  // Use the admin client (service role) to read role_registry without RLS
  // restrictions — the anon client can only read is_active=TRUE rows.
  const admin = getAdminClient()
  const { data: registry } = await admin
    .from('role_registry')
    .select('nav_group')
    .eq('role', profile.role)
    .single()

  // Allow if nav_group is 'admin' OR if the role is literally 'admin' (legacy)
  const isAdmin =
    registry?.nav_group === 'admin' || profile.role === 'admin'

  if (!isAdmin) throw new Error('Forbidden')
}

// ── List ALL users ─────────────────────────────────────────────────────────────

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

// ── Fetch a single user by ID ──────────────────────────────────────────────────

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

// ── Toggle active/inactive ─────────────────────────────────────────────────────

export async function setUserActive(userId: string, isActive: boolean) {
  await assertSuperAdmin()

  const admin = getAdminClient()

  const { error: profileError } = await admin
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)

  if (profileError) throw profileError

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

  if (!isActive) {
    await new Promise(r => setTimeout(r, 150))
    await admin.auth.admin.signOut(userId, 'global')
  }
}

// ── Reset password ─────────────────────────────────────────────────────────────

export async function adminResetPassword(userId: string, newPassword: string) {
  await assertSuperAdmin()

  if (newPassword.length < 8) throw new Error('Password must be at least 8 characters.')

  const admin = getAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword })
  if (error) throw error
}

// ── Update email address ───────────────────────────────────────────────────────

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

// ── Create a brand-new account ─────────────────────────────────────────────────
// FIX: nav_group and is_viewer_only are written into user_metadata so the
// JWT carries them — the middleware can enforce routes without a DB call.

export async function createAccount(input: {
  email:          string
  password:       string
  role:           string
  display_name:   string
  title:          string
  initials:       string
  avatar_color:   string
  nav_group:      'documents' | 'admin' | 'dpda-dpdo'
  can_upload:     boolean
  is_viewer_only: boolean
}) {
  await assertSuperAdmin()

  const admin = getAdminClient()

  // 1. Register in role_registry
  const { error: roleError } = await admin.rpc('register_role', {
    p_role:           input.role,
    p_display_name:   input.display_name,
    p_title:          input.title,
    p_nav_group:      input.nav_group,
    p_default_route:  input.nav_group === 'admin' ? '/admin/log-history' : '/admin/master',
    p_can_upload:     input.can_upload,
    p_is_viewer_only: input.is_viewer_only,
    p_sort_order:     100,
    p_created_by:     'admin',
  })
  if (roleError) throw new Error(`Role registration failed: ${roleError.message}`)

  // 2. Create auth user — include nav_group in user_metadata for JWT
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email:         input.email,
    password:      input.password,
    email_confirm: true,
    user_metadata: {
      role:           input.role,
      nav_group:      input.nav_group,
      is_viewer_only: input.is_viewer_only,
      is_active:      true,
    },
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

  // 4. Seed Drive pool
  await admin
    .from('users')
    .upsert({ username: input.role, role: 'USER' }, { onConflict: 'username' })

  return { userId }
}

// ── Delete account ─────────────────────────────────────────────────────────────

export async function deleteAccount(userId: string, role: string) {
  await assertSuperAdmin()

  const admin = getAdminClient()

  const PROTECTED_ROLES = ['admin', 'PD']
  if (PROTECTED_ROLES.includes(role)) {
    throw new Error(`The "${role}" account is protected and cannot be deleted.`)
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('role, display_name')
    .eq('id', userId)
    .single()

  const displayName = profile?.display_name ?? role

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId)
  if (authDeleteError) throw new Error(`Auth deletion failed: ${authDeleteError.message}`)

  await admin.from('profiles').delete().eq('id', userId)
  await admin.from('users').delete().eq('username', role)

  const { error: registryError } = await admin.rpc('deactivate_role', { p_role: role })
  if (registryError) throw new Error(`Registry deactivation failed: ${registryError.message}`)

  const supabase = await createServerClient()
  const { data: { user: actingUser } } = await supabase.auth.getUser()

  await admin.from('admin_logs').insert({
    user_id:     actingUser?.id ?? userId,
    role:        'admin',
    action:      'delete_account',
    description: `Deleted account: ${displayName} (${role})`,
  })

  return { success: true }
}