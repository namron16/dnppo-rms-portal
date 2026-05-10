
import { createClient } from './supabase/client'

/** Call on login with the Supabase user UUID */
export async function setAdminActive(userId: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('admin_presence')
    .upsert(
      { user_id: userId, is_active: true, last_seen: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  if (error) console.warn('setAdminActive warn:', error.message)
}

/** Call on logout with the Supabase user UUID */
export async function setAdminInactive(userId: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('admin_presence')
    .upsert(
      { user_id: userId, is_active: false, last_seen: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  if (error) console.warn('setAdminInactive warn:', error.message)
}