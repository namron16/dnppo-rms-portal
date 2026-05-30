// app/api/personnel/documents/route.ts
// Personnel 201 document upload API.
// POST — upload a 201 file to Drive pool and return Drive metadata

import { NextResponse } from 'next/server'
import { upload201Document } from '@/lib/gdrive-pool/migrate-modal'
import {updateDoc201Status} from '@/lib/data201'
import {createClient} from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

/** POST /api/personnel/documents — upload a 201 file to the Drive pool */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'P1') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const formData   = await request.formData()
    const file       = formData.get('file')       as File | null
    const docId      = formData.get('docId')      as string | null
    const uploadedBy = formData.get('uploadedBy') as string | null

    if (!file || !docId || !uploadedBy) {
      return NextResponse.json(
        { error: 'Missing required fields: file, docId, uploadedBy' },
        { status: 400 }
      )
    }

      const ALLOWED = new Set([
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ])
        if (!file.type.startsWith('image/') && !ALLOWED.has(file.type)) {
          return NextResponse.json(
            { error: `File type not allowed: ${file.type}. Accepted: PDF, images, DOCX, XLSX.` },
            { status: 415 }
          )
        }

    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File exceeds 50 MB limit.' }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    const result = await upload201Document({
      file:          buffer,
      fileName:      file.name,
      mimeType:      file.type,
      docId,
      uploadedBy,
      fileSizeBytes: file.size,
    })

    const fileSize = (file.size / 1024 / 1024).toFixed(1) + ' MB'
    await updateDoc201Status(docId, 'COMPLETE', result.fileUrl, fileSize, uploadedBy)

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (err: any) {
    console.error('[Personnel Documents API POST]', err.message)
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 })
  }
}