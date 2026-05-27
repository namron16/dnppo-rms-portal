// app/api/forward/[id]/save/route.ts
//
// REVISED FLOW
// ─────────────────────────────────────────────────────────────────────────────
// The client (forwarded/page.tsx) now uploads the file to the recipient's own
// Google Drive BEFORE calling this endpoint, using the same /api/gdrive/upload
// path that AddDocumentModal uses. The Drive result is passed in the request body.
//
// This endpoint:
//   1. Reads the forwarded_document row
//   2. Builds the Supabase insert payload using the client-supplied Drive URLs
//      (if provided) or falls back to sender's URLs (if client upload failed)
//   3. Inserts into the correct document table
//   4. Inserts attachments (using sender's URLs — attachment re-upload can be
//      added later if needed)
//   5. Marks the forwarded_document as saved
//
// No server-side Drive download/re-upload happens here at all.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSaveForwardedDocument, setCurrentLogger } from '@/lib/adminLogger'
import { AdminRole } from '@/lib/auth'

// ─── Table maps ───────────────────────────────────────────────────────────────

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

// ─── Drive result shape sent by the client ────────────────────────────────────

interface ClientDriveResult {
  gdriveFileId:  string
  fileUrl:       string
  downloadUrl:   string
  poolAccountId: string
  recordId:      string
  sizeBytes:     number
}

// ─── Supabase payload builder ─────────────────────────────────────────────────

/**
 * Builds the document row for the target table.
 *
 * Uses the recipient's own Drive URLs (driveResult) when the client upload
 * succeeded. Falls back to the sender's original references otherwise.
 *
 * The newDocId comes from the client so Drive records created during the
 * client-side upload already link to this ID correctly.
 */
function buildDocumentPayload(
  fwd:         any,
  uploaderRole: string,
  newDocId:     string,
  driveResult?: ClientDriveResult | null
): Record<string, any> {
  // Prefer recipient's own Drive copy; fall back to sender's
  const gdriveFileId  = driveResult?.gdriveFileId  ?? fwd.gdrive_file_id  ?? null
  const gdriveUrl     = driveResult?.fileUrl        ?? fwd.gdrive_url      ?? null
  const poolAccountId = driveResult?.poolAccountId  ?? fwd.pool_account_id ?? null
  const sizeBytes     = driveResult?.sizeBytes      ?? fwd.file_size_bytes ?? 0

  const driveFields = {
    gdrive_file_id:  gdriveFileId,
    gdrive_url:      gdriveUrl,
    pool_account_id: poolAccountId,
    file_name:       fwd.file_name        ?? null,
    file_size_bytes: sizeBytes,
    mime_type:       fwd.mime_type        ?? null,
    source:          'forwarded',
    forwarded_from:  fwd.sender_role,
    uploaded_by:     uploaderRole,
  }

  switch (fwd.document_type) {
    case 'master_document':
      return {
        id:    newDocId,
        title: fwd.title,
        level: 'REGIONAL',
        type:  fwd.mime_type?.includes('pdf')   ? 'PDF'
             : fwd.mime_type?.includes('word')  ? 'DOCX'
             : fwd.mime_type?.includes('sheet') ? 'XLSX'
             : 'PDF',
        date:     new Date().toISOString().split('T')[0],
        size:     sizeBytes ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB` : '0 MB',
        tag:      'COMPLIANCE',
        file_url: gdriveUrl,
        ...driveFields,
      }

    case 'admin_order':
      return {
        id:          newDocId,
        reference:   fwd.title,
        subject:     fwd.title,
        date:        new Date().toISOString().split('T')[0],
        attachments: 0,
        status:      'ACTIVE',
        file_url:    gdriveUrl,
        ...driveFields,
      }

    case 'daily_journal':
      return {
        id:          newDocId,
        title:       fwd.title,
        type:        'MEMO',
        author:      uploaderRole,
        date:        new Date().toISOString().split('T')[0],
        status:      'Draft',
        attachments: 0,
        archived:    false,
        file_url:    gdriveUrl,
        ...driveFields,
      }

    case 'library':
      return {
        id:         newDocId,
        title:      fwd.title,
        category:   'TEMPLATE',
        size:       sizeBytes ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB` : '0 MB',
        date_added: new Date().toISOString(),
        file_url:   gdriveUrl,
        ...driveFields,
      }

    default:
      return {
        id:       newDocId,
        title:    fwd.title,
        file_url: gdriveUrl,
        ...driveFields,
      }
  }
}

// ─── POST handler ─────────────────────────────────────────────────────────────

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

  // ── Parse request body ────────────────────────────────────────────────────
  //
  // Body shape: { newDocId: string, driveResult?: ClientDriveResult }
  //
  // driveResult is present when the client successfully uploaded to Drive.
  // newDocId is generated client-side so Drive records link correctly.
  //
  let body: { newDocId?: string; driveResult?: ClientDriveResult } = {}
  try {
    body = await req.json()
  } catch {
    // Empty body is fine — will generate newDocId server-side
  }

  // ── 1. Fetch the forwarded document ──────────────────────────────────────
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

  // ── 2. Resolve the doc ID ─────────────────────────────────────────────────
  //
  // Use the client-supplied newDocId so the Drive record created during
  // the client-side upload already references this ID.
  // Fall back to generating one here if the client didn't send it.
  //
  const newDocId = body.newDocId ?? (
    fwd.document_type === 'master_document' ? `md-${Date.now()}`
    : fwd.document_type === 'admin_order'   ? `so-${Date.now()}`
    : fwd.document_type === 'daily_journal' ? `dj-${Date.now()}`
    : `lib-${Date.now()}`
  )

  const driveResult = body.driveResult ?? null

  if (driveResult) {
    console.log(
      `[ForwardSave] Using client-uploaded Drive file: ` +
      `gdriveFileId=${driveResult.gdriveFileId}, pool=${driveResult.poolAccountId}`
    )
  } else {
    console.warn(
      `[ForwardSave] No client Drive result for forwarded doc ${id}. ` +
      `Falling back to sender's Drive references.`
    )
  }

  // ── 3. Build payload and insert document row ──────────────────────────────
  const payload = buildDocumentPayload(fwd, profile.role, newDocId, driveResult)

  const { data: newDoc, error: docError } = await supabase
    .from(targetTable)
    .insert(payload)
    .select()
    .single()

  if (docError || !newDoc) {
    console.error(
      '[ForwardSave] Document insert error:',
      docError?.message,
      'Payload keys:',
      Object.keys(payload)
    )
    return NextResponse.json(
      { error: docError?.message ?? 'Failed to save document' },
      { status: 500 }
    )
  }

  // ── 4. Insert attachments ─────────────────────────────────────────────────
  //
  // Attachments use the sender's Drive URLs for now.
  // The file is still accessible to the recipient since it was shared
  // with "anyone with link can view" when originally uploaded.
  //
  const attachments = fwd.forwarded_attachments ?? []

  if (attachments.length > 0 && attachmentTable && attachmentFk) {
    for (const att of attachments) {
      const { error: attError } = await supabase
        .from(attachmentTable)
        .insert({
          [attachmentFk]:  newDoc.id,
          title:           att.title,
          file_name:       att.file_name      ?? null,
          file_size_bytes: att.file_size_bytes ?? null,
          mime_type:       att.mime_type       ?? null,
          gdrive_file_id:  att.gdrive_file_id,
          gdrive_url:      att.gdrive_url,
          pool_account_id: att.pool_account_id,
          parent_id:       att.parent_attachment_id ?? null,
          depth:           att.depth ?? 0,
        })

      if (attError) {
        console.error('[ForwardSave] Attachment save error (non-fatal):', attError.message)
      }
    }
  }

  // ── 5. Mark forwarded record as saved ─────────────────────────────────────
  const { error: updateError } = await supabase
    .from('forwarded_documents')
    .update({
      status:       'saved',
      saved_at:     new Date().toISOString(),
      saved_doc_id: newDoc.id,
    })
    .eq('id', fwd.id)

  if (updateError) {
    console.error('[ForwardSave] Status update error:', updateError.message)
  }

  await logSaveForwardedDocument(fwd.title, fwd.sender_role, targetTable)

  return NextResponse.json({
    success:         true,
    savedDocId:      newDoc.id,
    table:           targetTable,
    driveReupload:   driveResult ? 'client_uploaded' : 'fallback_to_sender_drive',
    recipientDriveId: driveResult?.gdriveFileId ?? null,
  })
}