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

  // Explicitly delete any existing row for this role first.
  // This is belt-and-suspenders: even if the DB lacks a UNIQUE constraint
  // on `role`, we never end up with two rows for the same role.
  // Without this, upsert may INSERT a second row instead of updating,
  // causing isSessionValid()'s maybeSingle() to return null (multiple rows)
  // and log out BOTH browsers 30 seconds later.
  await supabase
    .from('active_sessions')
    .delete()
    .eq('role', role)

  const { error } = await supabase
    .from('active_sessions')
    .insert({
      role,
      session_token: token,
      user_id: userId,
      logged_in_at: new Date().toISOString(),
    })

  if (error) {
    throw new Error(error.message)
  }

  // Save to localStorage only after the DB write succeeds
  saveTokenLocally(token)
  return token
}

export async function isSessionValid(role: string): Promise<boolean> {
  const localToken = getLocalToken()
  if (!localToken) return false

  const supabase = createClient()
  const { data, error } = await supabase
    .from('active_sessions')
    .select('session_token')
    .eq('role', role)
    .maybeSingle()  // returns null instead of error when 0 or multiple rows

  if (error || !data) return false
  return data.session_token === localToken
}

export async function clearSession(role: string): Promise<void> {
  const supabase = createClient()
  const localToken = getLocalToken()

  // Clear local token first so re-entrant calls are no-ops
  clearLocalToken()

  if (!localToken) return

  // Only delete our own row — don't wipe the session of whoever took over
  await supabase
    .from('active_sessions')
    .delete()
    .eq('role', role)
    .eq('session_token', localToken)
}