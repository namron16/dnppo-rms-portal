// app/api/gdrive/delete/route.ts
import { NextResponse } from 'next/server'
import { deleteFile } from '@/lib/gdrive-pool/gateway'
import { getDriveClient, deleteFileFromDrive } from '@/lib/gdrive-pool/drive-client'
import { getServiceClient } from '@/lib/gdrive-pool/db'

export const runtime = 'nodejs'

/**
 * POST /api/gdrive/delete
 * Body: { gdriveFileId, poolAccountId }
 *
 * Looks up the records table entry automatically.
 * If no record row exists (pre-migration document), deletes directly from Drive.
 */
export async function POST(request: Request) {
  try {
    const { gdriveFileId, poolAccountId } = await request.json()

    if (!gdriveFileId || !poolAccountId) {
      return NextResponse.json(
        { error: 'Missing required fields: gdriveFileId, poolAccountId' },
        { status: 400 }
      )
    }

    const db = getServiceClient()

    // Look up the records table entry
    const { data: record } = await db
      .from('records')
      .select('id')
      .eq('gdrive_file_id', gdriveFileId)
      .maybeSingle()

    if (record?.id) {
      // Full cleanup: Drive file + records row + storage counter decrement
      const result = await deleteFile({
        gdriveFileId,
        poolAccountId,
        recordId: record.id,
      })

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 })
      }
    } else {
      // Pre-migration document — no records row, delete Drive file directly
      console.warn(
        `[Delete API] No records row found for gdriveFileId=${gdriveFileId} — ` +
        `deleting Drive file directly (pre-migration document)`
      )
      const drive = await getDriveClient(poolAccountId)
      await deleteFileFromDrive(drive, gdriveFileId)
    }

    return NextResponse.json({ data: { success: true } })
  } catch (err: any) {
    console.error('[Delete API]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Keep the original DELETE handler for any existing callers
export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    const { gdriveFileId, poolAccountId, recordId } = body

    if (!gdriveFileId || !poolAccountId || !recordId) {
      return NextResponse.json(
        { error: 'Missing required fields: gdriveFileId, poolAccountId, recordId' },
        { status: 400 }
      )
    }

    const result = await deleteFile({ gdriveFileId, poolAccountId, recordId })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ data: { success: true } })
  } catch (err: any) {
    console.error('[Delete API DELETE]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}