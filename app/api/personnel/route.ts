// app/api/personnel/archive/route.ts
//
// POST — Archives all Google Drive files for one or more expired personnel records.
//
// Called by archiveExpiredPersonnel201Records() in data201.ts (fire-and-forget).
// Can also be called manually from the admin panel to retry failed archives.
//
// Flow per personnel record:
//   1. Look up the uploader's pool account (who uploaded the 201 docs for this person)
//   2. Find the root_folder_id for that pool account
//   3. Call archivePersonnelFilesToDrive():
//        DDNPPO RMS → Personnel Files → {Surname, Name (Rank) - Archived}
//   4. Move each Drive file into that folder
//
// Auth: P1 only (same as create/update 201 files)

import { NextResponse } from 'next/server'
import { createClient }          from '@/lib/supabase/server'
import { getServiceClient }      from '@/lib/gdrive-pool/db'
import { archiveBatchPersonnelFiles } from '@/lib/gdrive-pool/archive-personnel'
import type { PersonnelArchiveInput } from '@/lib/gdrive-pool/archive-personnel'

export const runtime    = 'nodejs'
export const maxDuration = 60  // moving many files can take a while

// ── Input shape ───────────────────────────────────────────────────────────────

interface ArchiveRequestRecord {
  personnelId: string
  name:        string
  rank:        string
}

interface ArchiveRequest {
  records: ArchiveRequestRecord[]
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile || profile.role !== 'P1') {
    return NextResponse.json(
      { error: 'Forbidden. Only P1 may trigger personnel archiving.' },
      { status: 403 }
    )
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: ArchiveRequest
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!Array.isArray(body.records) || body.records.length === 0) {
    return NextResponse.json({ error: 'No records provided.' }, { status: 400 })
  }

  // ── Resolve pool account for P1 (the 201 uploader role) ───────────────────
  // All 201 documents are uploaded by P1, so we look up P1's Drive account.
  const db = getServiceClient()

  const { data: poolRow, error: poolError } = await db
    .from('storage_pool')
    .select('id, root_folder_id, is_active, status')
    .eq('owner_username', 'P1')
    .eq('is_active', true)
    .order('current_usage_bytes', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (poolError || !poolRow) {
    console.error('[Archive API] No active pool account for P1:', poolError?.message)
    return NextResponse.json(
      {
        error:
          'No active Google Drive account found for P1. ' +
          'Connect a Drive account for P1 at /admin/gdrive before archiving.',
      },
      { status: 503 }
    )
  }

  if (!poolRow.root_folder_id) {
    return NextResponse.json(
      {
        error:
          `Pool account ${poolRow.id} has no root_folder_id. ` +
          'Re-run the OAuth connect flow for P1 at /admin/gdrive.',
      },
      { status: 503 }
    )
  }

  // ── Build archive inputs ───────────────────────────────────────────────────
  const inputs: PersonnelArchiveInput[] = body.records.map(r => ({
    personnelId:   r.personnelId,
    name:          r.name,
    rank:          r.rank,
    rootFolderId:  poolRow.root_folder_id as string,
    poolAccountId: poolRow.id,
  }))

  // ── Run the batch archive ──────────────────────────────────────────────────
  console.log(
    `[Archive API] Archiving ${inputs.length} personnel record(s) ` +
    `using pool account ${poolRow.id} (root: ${poolRow.root_folder_id})`
  )

  const result = await archiveBatchPersonnelFiles(inputs)

  console.log(
    `[Archive API] Done: processed=${result.totalProcessed}, ` +
    `filesMoved=${result.totalFilesMoved}, failures=${result.failures.length}`
  )

  if (result.failures.length > 0) {
    console.error('[Archive API] Failures:', result.failures)
  }

  return NextResponse.json(
    {
      totalProcessed: result.totalProcessed,
      totalFilesMoved: result.totalFilesMoved,
      failures:        result.failures,
    },
    { status: result.failures.length === inputs.length ? 500 : 200 }
  )
}