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

// Returns true on success, false on failure
export async function saveStoredProfilePrefs(
  role: AdminRole,
  prefs: ProfilePrefs
): Promise<boolean> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false

  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: prefs.displayName,
      avatar_url:   prefs.avatarUrl,
    })
    .eq('id', user.id)

  return !error
}

// Keep old name as alias so any other callers don't break
export const saveProfilePrefs = saveStoredProfilePrefs

export async function uploadProfileAvatar(
  role: AdminRole,
  file: File
): Promise<string | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const ext  = file.name.split('.').pop() ?? 'jpg'
  const path = `avatars/${user.id}.${ext}`

  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type })

  if (error) {
    console.error('Avatar upload error:', error.message)
    return null
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  // Append cache-buster so the browser reloads the new image
  return `${data.publicUrl}?t=${Date.now()}`
}