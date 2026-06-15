// app/api/gdrive/upload/route.ts
import { NextResponse } from 'next/server'
import { uploadViaPool } from '@/lib/gdrive-pool/migrate-modal'
import type { DocumentCategory } from '@/lib/gdrive-pool/types'

export const runtime = 'nodejs'
export const maxDuration = 60

// Add this helper above the POST handler
function classifyUploadError(err: any): { message: string; status: number } {
  const msg = String(err?.message ?? '')

  if (
    msg.includes('No active pool account') ||
    msg.includes('no pool') ||
    msg.includes('pool account') ||
    msg.includes('No active Google Drive account') ||
    msg.includes('no connected')
  )
    return {
      message: 'No Google Drive account connected. Ask your admin to connect one at Settings → Google Drive.',
      status: 503,
    }

  if (
    msg.includes('invalid_grant') ||
    msg.includes('Token has been expired') ||
    msg.includes('Invalid Credentials') ||
    msg.includes('reconnect')
  )
    return {
      message: 'Google Drive session expired. Please reconnect your Drive account.',
      status: 401,
    }

  if (
    msg.includes('storageQuota') ||
    msg.includes("user's Drive storage quota has been exceeded")
  )
    return {
      message: 'Google Drive is full. Free up space or ask your admin to connect a different account.',
      status: 507,
    }

  if (
    msg.includes('insufficientPermissions') ||
    msg.includes('forbidden') ||
    msg.toLowerCase().includes('permission') ||
    msg.includes('Drive auth error')
  )
    return {
      message: 'Drive permission denied. Please reconnect your Google Drive and allow all permissions.',
      status: 403,
    }

  if (msg.includes('ownership mismatch'))
    return {
      message: 'Storage account mismatch. Please contact your admin.',
      status: 403,
    }

  if (msg.includes('no root folder') || msg.includes('root_folder_id'))
    return {
      message: 'Drive account not fully set up. Please reconnect your Google Drive.',
      status: 422,
    }

  if (msg.includes('File exceeds'))
    return { message: 'File is too large. Maximum allowed size is 50 MB.', status: 413 }

  if (msg.includes('File type not allowed') || msg.includes('Unsupported MIME'))
    return { message: 'File type not supported. Please upload a PDF, image, DOCX, or XLSX.', status: 415 }

  if (msg.includes('Folder resolution failed'))
    return {
      message: 'Could not create Drive folder. Try reconnecting your Google Drive.',
      status: 500,
    }

  if (msg.includes('Database record insert failed'))
    return {
      message: 'File uploaded but record save failed. Please contact your admin.',
      status: 500,
    }

  return {
    message: 'Upload failed. Please try again or contact your admin if the issue persists.',
    status: 500,
  }
}

export async function POST(request: Request) {
  try {
    const formData       = await request.formData()
    const file            = formData.get('file')       as File | null
    const category        = formData.get('category')   as DocumentCategory | null
    const entityType      = formData.get('entityType') as string | null
    const entityId        = formData.get('entityId')   as string | null
    const uploadedBy      = formData.get('uploadedBy') as string | null
    const preferredPoolId = formData.get('preferredPoolId') as string | null

    if (!file || !category || !uploadedBy) {
      return NextResponse.json(
        { error: 'Missing required fields: file, category, uploadedBy' },
        { status: 400 }
      )
    }

    // ── MIME check: allow PDF, images, and common document types ────────────
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]
    const isAllowed =
      file.type.startsWith('image/') ||
      allowedMimes.includes(file.type)

    if (!isAllowed) {
      return NextResponse.json(
        { error: `File type not allowed: ${file.type}. Accepted: PDF, images, DOCX, XLSX.` },
        { status: 415 }
      )
    }

    const MAX_BYTES = 50 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File exceeds 50 MB limit.' }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    console.log(`[Upload API] Starting upload: ${file.name} (${file.type}, ${file.size} bytes) → category=${category}, uploadedBy=${uploadedBy}`)

    const result = await uploadViaPool({
      file:          buffer,
      fileName:      file.name,
      mimeType:      file.type,
      category,
      entityType:    entityType    ?? undefined,
      entityId:      entityId      ?? undefined,
      uploadedBy,
      fileSizeBytes: file.size,
      preferredPoolId: preferredPoolId ?? undefined,
    })

    console.log(`[Upload API] Success: gdriveFileId=${result.gdriveFileId}, poolAccountId=${result.poolAccountId}`)

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (err: any) {
    // Log the FULL error so it appears in your server logs / Vercel function logs
    console.error('[Upload API] FAILED:', err?.message ?? err)
    console.error('[Upload API] Stack:', err?.stack)
    const { message, status } = classifyUploadError(err)
    return NextResponse.json({ error: message }, { status })
  }
}