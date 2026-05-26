// app/api/forward/[id]/save/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSaveForwardedDocument, setCurrentLogger } from '@/lib/adminLogger'
import { AdminRole } from '@/lib/auth'

const DOCUMENT_TABLE_MAP: Record<string, string> = {
  master_document: 'master_documents',
  admin_order:     'special_orders',
  daily_journal:   'daily_journals',
  library:         'library_items',
}

const ATTACHMENT_TABLE_MAP: Record<string, string> = {
  master_document: 'master_document_attachments',
  admin_order:     'special_order_attachments',
  daily_journal:   'daily_journal_attachments',
  library:         'library_item_attachments',
}

const ATTACHMENT_FK_MAP: Record<string, string> = {
  master_document: 'master_document_id',
  admin_order:     'special_order_id',
  daily_journal:   'daily_journal_id',
  library:         'library_item_id',
}

/**
 * Builds a document insert payload tailored to each table's schema.
 * All four tables now have the Drive-pool columns after the migration,
 * but each table also has its own required columns that differ.
 */
function buildDocumentPayload(
  fwd: any,
  uploaderRole: string
): Record<string, any> {
  // Shared Drive-pool fields — present in all four tables after migration
  const driveFields = {
    gdrive_file_id:  fwd.gdrive_file_id  ?? null,
    gdrive_url:      fwd.gdrive_url       ?? null,
    pool_account_id: fwd.pool_account_id  ?? null,
    file_name:       fwd.file_name        ?? null,
    file_size_bytes: fwd.file_size_bytes  ?? null,
    mime_type:       fwd.mime_type        ?? null,
    source:          'forwarded',
    forwarded_from:  fwd.sender_role,
    uploaded_by:     uploaderRole,
  }

  switch (fwd.document_type) {
    case 'master_document':
      return {
        // master_documents uses app-generated text PKs
        id:    `md-${Date.now()}`,
        title: fwd.title,
        level: 'REGIONAL',
        type:  fwd.mime_type?.includes('pdf')  ? 'PDF'
             : fwd.mime_type?.includes('word') ? 'DOCX'
             : fwd.mime_type?.includes('sheet') ? 'XLSX'
             : 'PDF',
        date:  new Date().toISOString().split('T')[0],
        size:  fwd.file_size_bytes
                 ? `${(fwd.file_size_bytes / 1024 / 1024).toFixed(1)} MB`
                 : '0 MB',
        tag:   'COMPLIANCE',
        // file_url kept for backward-compat with existing queries
        file_url: fwd.gdrive_url ?? null,
        ...driveFields,
      }

    case 'admin_order':
      return {
        id:          `so-${Date.now()}`,
        reference:   fwd.title,
        subject:     fwd.title,
        date:        new Date().toISOString().split('T')[0],
        attachments: 0,
        status:      'ACTIVE',
        file_url:    fwd.gdrive_url ?? null,
        ...driveFields,
      }

    case 'daily_journal':
      return {
        id:          `dj-${Date.now()}`,
        title:       fwd.title,
        type:        'MEMO',
        author:      uploaderRole,
        date:        new Date().toISOString().split('T')[0],
        status:      'Draft',
        attachments: 0,
        archived:    false,
        file_url:    fwd.gdrive_url ?? null,
        ...driveFields,
      }

    case 'library':
      return {
        id:          `lib-${Date.now()}`,
        title:       fwd.title,
        category:    'TEMPLATE',
        size:        fwd.file_size_bytes
                       ? `${(fwd.file_size_bytes / 1024 / 1024).toFixed(1)} MB`
                       : '0 MB',
        date_added:  new Date().toISOString(),
        file_url:    fwd.gdrive_url ?? null,
        ...driveFields,
      }

    default:
      return {
        title:    fwd.title,
        file_url: fwd.gdrive_url ?? null,
        ...driveFields,
      }
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
  setCurrentLogger(profile.role as AdminRole, user.id)

  // 1. Fetch the forwarded document
  const { data: fwd, error: fetchError } = await supabase
    .from('forwarded_documents')
    .select('*, forwarded_attachments(*)')
    .eq('id', id)
    .eq('recipient_role', profile.role)
    .single()

  if (fetchError || !fwd) {
    return NextResponse.json({ error: 'Forwarded document not found' }, { status: 404 })
  }

  if (fwd.status !== 'pending') {
    return NextResponse.json(
      { error: `Document already ${fwd.status}` },
      { status: 409 }
    )
  }

  const targetTable     = DOCUMENT_TABLE_MAP[fwd.document_type]
  const attachmentTable = ATTACHMENT_TABLE_MAP[fwd.document_type]
  const attachmentFk    = ATTACHMENT_FK_MAP[fwd.document_type]

  if (!targetTable) {
    return NextResponse.json(
      { error: `Unknown document_type: ${fwd.document_type}` },
      { status: 400 }
    )
  }

  // 2. Build table-specific payload and insert
  const payload = buildDocumentPayload(fwd, profile.role)

  const { data: newDoc, error: docError } = await supabase
    .from(targetTable)
    .insert(payload)
    .select()
    .single()

  if (docError || !newDoc) {
    console.error('Document insert error:', docError?.message, 'Payload keys:', Object.keys(payload))
    return NextResponse.json(
      { error: docError?.message ?? 'Failed to save document' },
      { status: 500 }
    )
  }

  // 3. Insert attachments (non-fatal if they fail)
  const attachments = fwd.forwarded_attachments ?? []
  if (attachments.length > 0) {
    const attRows = attachments.map((att: any) => ({
      [attachmentFk]:  newDoc.id,
      title:           att.title,
      file_name:       att.file_name   ?? null,
      file_size_bytes: att.file_size_bytes ?? null,
      mime_type:       att.mime_type   ?? null,
      gdrive_file_id:  att.gdrive_file_id,
      gdrive_url:      att.gdrive_url,
      pool_account_id: att.pool_account_id,
      parent_id:       att.parent_attachment_id ?? null,
      depth:           att.depth ?? 0,
    }))

    const { error: attError } = await supabase
      .from(attachmentTable)
      .insert(attRows)

    if (attError) {
      console.error('Attachment save error (non-fatal):', attError.message)
    }
  }

  // 4. Mark forwarded record as saved
  const { error: updateError } = await supabase
    .from('forwarded_documents')
    .update({
      status:       'saved',
      saved_at:     new Date().toISOString(),
      saved_doc_id: newDoc.id,
    })
    .eq('id', fwd.id)

  if (updateError) {
    console.error('Status update error:', updateError.message)
  }

  await logSaveForwardedDocument(fwd.title, fwd.sender_role, targetTable)

  return NextResponse.json({
    success:    true,
    savedDocId: newDoc.id,
    table:      targetTable,
  })
}