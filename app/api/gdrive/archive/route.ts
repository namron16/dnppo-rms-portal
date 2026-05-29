import { NextResponse } from 'next/server'
import { moveFileToArchiveFolder } from '@/lib/gdrive-pool/gateway'
import { getPoolAccountFull } from '@/lib/gdrive-pool/db'
import type { DocumentCategory } from '@/lib/gdrive-pool/types'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const { gdriveFileId, poolAccountId, category } = await request.json()

    if (!gdriveFileId || !poolAccountId || !category) {
      return NextResponse.json(
        { error: 'Missing required fields: gdriveFileId, poolAccountId, category' },
        { status: 400 }
      )
    }

    // Get root folder for this pool account
    const poolRow = await getPoolAccountFull(poolAccountId)
    if (!poolRow.root_folder_id) {
      return NextResponse.json(
        { error: 'Pool account has no root folder configured.' },
        { status: 422 }
      )
    }

    const result = await moveFileToArchiveFolder(
      poolAccountId,
      gdriveFileId,
      category as DocumentCategory,
      poolRow.root_folder_id
    )

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ data: { success: true } })
  } catch (err: any) {
    console.error('[Archive API]', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}