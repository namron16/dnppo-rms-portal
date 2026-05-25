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

export async function registerSession(role: string, userId: string): Promise<string> {
  const supabase = createClient()
  const token = generateToken()

  const { error } = await supabase
    .from('active_sessions')
    .upsert(
      {
        role,
        session_token: token,
        user_id: userId,
        logged_in_at: new Date().toISOString(),
      },
      { onConflict: 'role' }   // explicit — ensures upsert key is always `role`
    )

  if (error) {
    throw new Error(error.message)
  }

  // Save to localStorage AFTER the DB write succeeds
  saveTokenLocally(token)
  return token
}

export async function isSessionValid(role: string): Promise<boolean> {
  const localToken = getLocalToken()

  // No local token means this browser never registered (or was cleared).
  // Return true here so we don't falsely kick out a restored session
  // that hasn't re-registered yet (e.g. on hard refresh before init completes).
  // The session polling in AuthGuard only starts after user+isLoading are stable,
  // so by the time this is called the token should always be present.
  // Treat missing token as invalid — but callers must guard with isLoading.
  if (!localToken) return false

  const supabase = createClient()
  const { data, error } = await supabase
    .from('active_sessions')
    .select('session_token')
    .eq('role', role)
    .maybeSingle()             // use maybeSingle so missing row = null, not an error

  if (error || !data) return false
  return data.session_token === localToken
}

export async function clearSession(role: string): Promise<void> {
  const supabase = createClient()
  const localToken = getLocalToken()

  // Always clear the local token first so subsequent checks fail fast
  clearLocalToken()

  if (!localToken) return

  // Only delete the row if we own it (token matches).
  // This prevents Browser 1 from deleting the row that Browser 2 just wrote.
  await supabase
    .from('active_sessions')
    .delete()
    .eq('role', role)
    .eq('session_token', localToken)
}