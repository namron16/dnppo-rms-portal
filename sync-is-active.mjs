/**
 * sync-is-active.mjs
 *
 * One-time backfill: reads is_active from public.profiles and writes it
 * into each auth user's user_metadata via the Supabase admin API.
 *
 * Run once:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node sync-is-active.mjs
 *
 * Safe to re-run — it's idempotent.
 */

const SUPABASE_URL             = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.')
  process.exit(1)
}

const BASE   = `${SUPABASE_URL}/rest/v1`
const AUTH   = `${SUPABASE_URL}/auth/v1/admin/users`
const HEADERS = {
  'apikey':        SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type':  'application/json',
}

// ── 1. Fetch all profiles (id + is_active) ──────────────────────────────────

async function fetchProfiles() {
  const res = await fetch(`${BASE}/profiles?select=id,is_active`, { headers: HEADERS })
  if (!res.ok) throw new Error(`profiles fetch failed: ${res.status} ${await res.text()}`)
  return res.json()    // [{ id, is_active }, ...]
}

// ── 2. Fetch current user_metadata for one user ─────────────────────────────

async function fetchUser(userId) {
  const res = await fetch(`${AUTH}/${userId}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`fetchUser(${userId}) failed: ${res.status}`)
  return res.json()
}

// ── 3. Patch user_metadata (merges — does not overwrite other keys) ─────────

async function patchUserMetadata(userId, patch) {
  const user  = await fetchUser(userId)
  const merged = { ...user.user_metadata, ...patch }

  const res = await fetch(`${AUTH}/${userId}`, {
    method:  'PUT',
    headers: HEADERS,
    body:    JSON.stringify({ user_metadata: merged }),
  })
  if (!res.ok) throw new Error(`patchUser(${userId}) failed: ${res.status} ${await res.text()}`)
  return res.json()
}

// ── 4. Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔄  Fetching profiles…')
  const profiles = await fetchProfiles()
  console.log(`✅  Found ${profiles.length} profile(s).`)

  let ok = 0, skipped = 0, failed = 0

  for (const profile of profiles) {
    const { id, is_active } = profile
    // Default to true if somehow null
    const flag = is_active ?? true

    try {
      const user = await fetchUser(id)
      const current = user.user_metadata?.is_active

      if (current === flag) {
        console.log(`  ⏭  ${id} — already correct (is_active=${flag}), skipping`)
        skipped++
        continue
      }

      await patchUserMetadata(id, { is_active: flag })
      console.log(`  ✅  ${id} — set is_active=${flag} (was ${current ?? 'unset'})`)
      ok++
    } catch (err) {
      console.error(`  ❌  ${id} — ${err.message}`)
      failed++
    }
  }

  console.log('\n── Summary ──────────────────────────')
  console.log(`  Updated : ${ok}`)
  console.log(`  Skipped : ${skipped}  (already correct)`)
  console.log(`  Failed  : ${failed}`)

  if (failed > 0) {
    console.log('\n⚠️  Some users failed. Check errors above and re-run — script is safe to retry.')
    process.exit(1)
  } else {
    console.log('\n🎉  All done. user_metadata.is_active is now in sync with profiles.is_active.')
  }
}

main().catch(err => { console.error(err); process.exit(1) })



//run in terminal
//$env:SUPABASE_URL="https://jbjulzwqrgwglvimqtns.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpianVsendxcmd3Z2x2aW1xdG5zIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Mzk4Njk5OSwiZXhwIjoyMDg5NTYyOTk5fQ.dEa_R3osJIlwGjsuRVzLOieMxsQS9SdtGFHJLLE78Ks"; node sync-is-active.mjs  
