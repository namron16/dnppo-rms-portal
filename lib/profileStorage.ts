
import { createClient } from './supabase/client'
import type { AdminRole } from './auth'

export interface ProfilePrefs {
  displayName?: string
  avatarUrl?:   string
}

export async function getStoredProfilePrefs(role: AdminRole): Promise<ProfilePrefs> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}

  const { data } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .single()

  return {
    displayName: data?.display_name ?? undefined,
    avatarUrl:   data?.avatar_url   ?? undefined,
  }
}

export async function saveProfilePrefs(
  role: AdminRole,
  prefs: ProfilePrefs
): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('profiles')
    .update({
      display_name: prefs.displayName,
      avatar_url:   prefs.avatarUrl,
    })
    .eq('id', user.id)
}