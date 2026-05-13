// app/api/gdrive/callback/route.ts
// OAuth2 callback: exchanges the authorization code for tokens,
// creates the DDNPPO RMS root folder, and persists everything to Supabase.

import {NextResponse} from 'next/server'
import { google }       from 'googleapis'
import {
  exchangeCodeForTokens,
  getAuthenticatedEmail,
  createRootFolder,
} from '@/lib/gdrive-pool/drive-client'
import { upsertPoolAccount, logHealthEvent } from '@/lib/gdrive-pool/db'

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

    // 3. Build a one-time Drive client to create the root folder
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

    // 5. Log connect event
    await logHealthEvent({
      pool_account_id: poolAccountId,
      event_type:      'connect',
      status:          'ok',
      message:         `${username} connected Google account ${accountEmail} — root folder: ${rootFolderId}`,
      latency_ms:      null,
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