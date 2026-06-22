'use client'

import { createClient } from './supabase/client'

const SESSION_TOKEN_KEY = 'dnppo_session_token'

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage
}

export function generateToken(): string {
  return crypto.randomUUID()
}

export function saveTokenLocally(token: string) {
  getStorage()?.setItem(SESSION_TOKEN_KEY, token)
}

export function getLocalToken(): string | null {
  return getStorage()?.getItem(SESSION_TOKEN_KEY) ?? null
}

export function clearLocalToken() {
  getStorage()?.removeItem(SESSION_TOKEN_KEY)
}

// ── Fetch the configured session duration from system_settings ────────────────
// Falls back to 24 hours if the table is unreachable (e.g. cold start).
async function fetchSessionDurationHours(
  supabase: ReturnType<typeof createClient>
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('session_duration_hours')
      .eq('id', 1)
      .single()

    if (error || !data) return 24
    return data.session_duration_hours ?? 24
  } catch {
    return 24
  }
}

// ── Register a new session ────────────────────────────────────────────────────
// Think of this like stamping a library book: it records WHO has it,
// WHEN they took it, and WHEN it must be returned (expires_at).
export async function registerSession(role: string, userId: string): Promise<string> {
  const supabase = createClient()

  // 1. Find out how long this session is allowed to last
  const durationHours = await fetchSessionDurationHours(supabase)

  const token     = generateToken()
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString()

  // 2. Remove any existing row for this role first.
  //    (role is PRIMARY KEY so there can only be one active session per role)
  await supabase
    .from('active_sessions')
    .delete()
    .eq('role', role)

  // 3. Insert the new session row with the expiry timestamp
  const { error } = await supabase
    .from('active_sessions')
    .insert({
      role,
      session_token: token,
      user_id:       userId,
      logged_in_at:  new Date().toISOString(),
      expires_at:    expiresAt,
    })

  if (error) throw new Error(error.message)

  // 4. Only save the token locally after the DB write succeeds
  saveTokenLocally(token)
  return token
}

// ── Session validity check ────────────────────────────────────────────────────
// Returns one of three outcomes so AuthGuard can show the right message:
//   'valid'           — token matches and hasn't expired
//   'expired'         — token matches but expires_at is in the past
//   'taken'           — token doesn't match (another browser logged in)
//   'invalid'         — no local token / DB row missing
export type SessionCheckResult = 'valid' | 'expired' | 'taken' | 'invalid'

export async function checkSessionStatus(role: string): Promise<SessionCheckResult> {
  const localToken = getLocalToken()
  if (!localToken) return 'invalid'

  const supabase = createClient()
  const { data, error } = await supabase
    .from('active_sessions')
    .select('session_token, expires_at')
    .eq('role', role)
    .maybeSingle()

  if (error || !data) return 'invalid'

  // Token mismatch — someone else logged in on another browser
  if (data.session_token !== localToken) return 'taken'

  // Token matches — now check expiry
  const now       = Date.now()
  const expiresAt = new Date(data.expires_at).getTime()
  if (now >= expiresAt) return 'expired'

  return 'valid'
}

// ── Legacy boolean wrapper (kept for any callers outside AuthGuard) ───────────
export async function isSessionValid(role: string): Promise<boolean> {
  const result = await checkSessionStatus(role)
  return result === 'valid'
}

// ── Clear session on intentional logout ──────────────────────────────────────
// Only deletes the row we own — never wipes a row written by Browser 2.
export async function clearSession(role: string): Promise<void> {
  const supabase   = createClient()
  const localToken = getLocalToken()

  // Clear local token first so any re-entrant calls are immediate no-ops
  clearLocalToken()

  if (!localToken) return

  await supabase
    .from('active_sessions')
    .delete()
    .eq('role', role)
    .eq('session_token', localToken)
}