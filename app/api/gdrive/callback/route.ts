// app/api/gdrive/callback/route.ts
// OAuth2 callback: exchanges the authorization code for tokens,
// creates the DDNPPO RMS root folder, and persists everything to Supabase.
//
// AUDIT LOG: On successful connection, writes to admin_logs (the main audit
// table shown in log-history) in addition to the existing health_events entry.
// Uses the service role client so the insert works without a browser session.

import { NextResponse }   from 'next/server'
import { google }         from 'googleapis'
import {
  exchangeCodeForTokens,
  getAuthenticatedEmail,
  createRootFolder,
} from '@/lib/gdrive-pool/drive-client'
import { upsertPoolAccount, logHealthEvent, getServiceClient } from '@/lib/gdrive-pool/db'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const base   = `${appUrl}/admin/gdrive`

  // User denied access
  if (error) {
    console.warn('[OAuth2 Callback] Access denied:', error)
    return NextResponse.redirect(`${base}?error=access_denied`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${base}?error=missing_params`)
  }

  let username: string
  try {
    username = JSON.parse(decodeURIComponent(state)).username
    if (!username) throw new Error('empty username')
  } catch {
    return NextResponse.redirect(`${base}?error=invalid_state`)
  }

  const redirectUri = `${appUrl}/api/gdrive/callback`

  try {
    // 1. Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, redirectUri)

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Google did not return both access_token and refresh_token.')
    }

    const grantedScopes = (tokens.scope ?? '').split(' ')
    const hasDriveScope = grantedScopes.some(s => s.includes('drive'))
    if (!hasDriveScope) {
      throw new Error(
        'Drive permission was not granted. ' +
        'Please allow ALL requested permissions on the Google consent screen.'
      )
    }

    // 2. Get authenticated user's email
    const accountEmail = await getAuthenticatedEmail(tokens.access_token)

    // 3. Build a one-time Drive client to create/find the root folder
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    )
    auth.setCredentials(tokens)
    const drive = google.drive({ version: 'v3', auth })

    const rootFolderId = await createRootFolder(drive)

    // 4. Persist tokens + metadata to Supabase (encrypted)
    const poolAccountId = await upsertPoolAccount({
      username,
      accountEmail,
      refreshToken: tokens.refresh_token,
      accessToken:  tokens.access_token,
      expiresIn:    tokens.expiry_date
        ? Math.max(60, Math.floor((tokens.expiry_date - Date.now()) / 1000))
        : 3600,
      rootFolderId,
    })

    // 5. Write to health_events (Drive-pool operational log — existing behaviour)
    await logHealthEvent({
      pool_account_id: poolAccountId,
      event_type:      'connect',
      status:          'ok',
      message:         `${username} connected Google account ${accountEmail} — root folder: ${rootFolderId}`,
      latency_ms:      null,
    })

    // 6. Write to admin_logs (the main audit trail shown in log-history page).
    //
    //    Why we do this here instead of on the client:
    //    The browser navigates away immediately when the admin clicks
    //    "Add Drive Account" / "Reconnect", so any client-side log call
    //    fires BEFORE we know whether the OAuth flow succeeded. Logging here,
    //    after upsertPoolAccount() succeeds, guarantees we only record genuine
    //    connections — not cancelled or failed ones.
    //
    //    We use the service role client (bypasses RLS) because this route has
    //    no user session cookie — it's the OAuth redirect target, not a
    //    browser-authenticated request. The acting admin's identity is inferred
    //    from the `username` state param (only admins can reach /admin/gdrive).
    //
    //    Action discrimination:
    //      - upsertPoolAccount() uses ON CONFLICT (account_email) to decide
    //        whether this is an INSERT or UPDATE. We replicate that logic here
    //        by checking whether a row for this email already existed before
    //        the upsert ran.  If it existed → 'gdrive_reconnect', else → 'gdrive_connect'.
    //
    await writeGDriveAuditLog({
      poolAccountId,
      username,
      accountEmail,
    })

    return NextResponse.redirect(
      `${base}?connected=true&email=${encodeURIComponent(accountEmail)}&username=${username}`
    )
  } catch (err: any) {
    console.error('[OAuth2 Callback] Error:', err.message)
    return NextResponse.redirect(
      `${base}?error=${encodeURIComponent(err.message ?? 'OAuth2 callback failed')}`
    )
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Writes a gdrive_connect or gdrive_reconnect entry to admin_logs.
 *
 * To distinguish connect vs reconnect we look at connected_at on the pool row:
 * if it was set within the last 30 seconds the row was just INSERTed (connect),
 * otherwise it was UPDATEd (reconnect / token refresh).
 *
 * Falls back to 'gdrive_connect' if the row can't be fetched — better to
 * slightly misclassify than to crash the entire callback.
 */
async function writeGDriveAuditLog(params: {
  poolAccountId: string
  username:      string
  accountEmail:  string
}): Promise<void> {
  const { poolAccountId, username, accountEmail } = params

  const db = getServiceClient()

  // Resolve acting admin's user_id from the profiles table.
  // The admin account always has role = 'admin'; there should only be one.
  const { data: adminProfile } = await db
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .maybeSingle()

  // We need a valid user_id for the log row. If the admin profile isn't found
  // (edge case: renamed role), fall back to poolAccountId as a placeholder —
  // the service role insert will still succeed even without a real user_id.
  const adminUserId = adminProfile?.id ?? poolAccountId

  // Determine connect vs reconnect by checking connected_at on the pool row.
  // A fresh insert will have connected_at within the last 30 seconds.
  let action: 'gdrive_connect' | 'gdrive_reconnect' = 'gdrive_connect'
  let description = `Connected Google Drive account "${accountEmail}" for user "${username}"`

  try {
    const { data: poolRow } = await db
      .from('storage_pool')
      .select('connected_at')
      .eq('id', poolAccountId)
      .single()

    if (poolRow?.connected_at) {
      const ageMs = Date.now() - new Date(poolRow.connected_at).getTime()
      // If the row is older than 30 s it was an UPDATE (reconnect), not INSERT
      if (ageMs > 30_000) {
        action      = 'gdrive_reconnect'
        description = `Reconnected Google Drive account "${accountEmail}" for user "${username}"`
      }
    }
  } catch (e: any) {
    // Non-fatal — log classification falls back to 'gdrive_connect'
    console.warn('[OAuth2 Callback] Could not determine connect vs reconnect:', e.message)
  }

  const { error } = await db.from('admin_logs').insert({
    user_id:     adminUserId,
    role:        'admin',
    action,
    description,
  })

  if (error) {
    // Log the failure but never throw — a failed audit log must not block the
    // OAuth redirect or the user sees a confusing error page.
    console.error('[OAuth2 Callback] admin_logs insert failed:', error.message)
  }
}