import { NextResponse } from 'next/server'
import { moveFileFromArchiveFolder } from '@/lib/gdrive-pool/gateway'
import { getPoolAccountFull } from '@/lib/gdrive-pool/db'
import type { DocumentCategory } from '@/lib/gdrive-pool/types'

export const runtime = 'nodejs'

function classifyRestoreError(err: any): { message: string; status: number } {
  const msg = String(err?.message ?? '')

  if (msg.includes('invalid_grant') || msg.includes('Token has been expired') || msg.includes('Invalid Credentials'))
    return { message: 'Google Drive session expired. Please reconnect your Drive account.', status: 401 }

  if (msg.includes('insufficientPermissions') || msg.toLowerCase().includes('permission') || msg.includes('forbidden'))
    return { message: 'Drive permission denied. Please reconnect your Google Drive.', status: 403 }

  if (msg.includes('notFound') || msg.includes('File not found') || msg.includes('404'))
    return { message: 'File not found in Google Drive. It may have been deleted or moved manually.', status: 404 }

  if (msg.includes('root_folder_id') || msg.includes('no root folder') || msg.includes('root folder configured'))
    return { message: 'Drive account not fully set up. Please reconnect your Google Drive.', status: 422 }

  if (msg.includes('Folder resolution failed') || msg.includes('findOrCreateFolder'))
    return { message: 'Could not locate the destination folder. Please try again.', status: 500 }

  return { message: 'Restore failed. Please try again or contact your admin.', status: 500 }
}

export async function POST(request: Request) {
  try {
    const { gdriveFileId, poolAccountId, category } = await request.json()

    if (!gdriveFileId || !poolAccountId || !category) {
      return NextResponse.json(
        { error: 'Missing required fields: gdriveFileId, poolAccountId, category' },
        { status: 400 }
      )
    }

    const poolRow = await getPoolAccountFull(poolAccountId)
    if (!poolRow.root_folder_id) {
      return NextResponse.json(
        { error: 'Pool account has no root folder configured.' },
        { status: 422 }
      )
    }

    const result = await moveFileFromArchiveFolder(
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
    console.error('[Restore API]', err.message)
  const { message, status } = classifyRestoreError(err)
  return NextResponse.json({ error: message }, { status })
  }
}