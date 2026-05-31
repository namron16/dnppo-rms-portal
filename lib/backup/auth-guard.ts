// lib/backup/auth-guard.ts
// Guards all backup and recovery API routes.
//
// Role hierarchy (from lib/auth.tsx):
//   admin  — Super Admin: manages users, can manage backup/recovery
//   P1     — Records Officer: can upload, manage visibility, but NOT system backup
//   PD     — Provincial Director: view-only, final approval
//   DPDA/DPDO — Deputy Directors: review approval, view-only
//   P2–P10 — Admin Officers: upload + view
//
// Backup & Recovery is a system-level operation that belongs to the 'admin' role.
// P1 (Records Officer) is a document-level super user, not a system administrator.

import { createClient } from '@/lib/supabase/server'

/**
 * Custom error class for authentication failures.
 * Includes a code field to distinguish between different failure types.
 */
export class AuthError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'AuthError'
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
    }
  }
}

/**
 * Returns the current authenticated user with their profile.
 * Throws AuthError if not authenticated.
 */
export async function getCurrentUser(): Promise<{ id: string; role: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new AuthError('UNAUTHENTICATED', 'User is not authenticated')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile) {
    throw new AuthError('PROFILE_NOT_FOUND', 'User profile not found')
  }

  return {
    id: user.id,
    role: profile.role,
  }
}

/**
 * Throws if the calling user is not the 'admin' (Super Admin) role.
 * Use at the top of every backup/recovery API route handler.
 *
 * @example
 * export async function POST(request: Request) {
 *   try { await requireAdmin() } catch {
 *     return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
 *   }
 *   // ... rest of handler
 * }
 */
export async function requireAdmin(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new AuthError('UNAUTHENTICATED', 'User is not authenticated')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    throw new AuthError(
      'FORBIDDEN',
      'Backup and recovery operations require the Super Admin (admin) role.'
    )
  }
}

/**
 * Returns true if the calling user is the admin role, false otherwise.
 * Use this for conditional UI gating in server components or server actions.
 */
export async function isAdmin(): Promise<boolean> {
  try {
    await requireAdmin()
    return true
  } catch {
    return false
  }
}

/**
 * Returns true if the calling user is the admin role, false otherwise.
 * Use this for conditional UI gating in server components or server actions.
 */
