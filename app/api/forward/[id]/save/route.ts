// app/api/forward/[id]/save/route.ts


import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSaveForwardedDocument, setCurrentLogger } from '@/lib/adminLogger'
import { AdminRole } from '@/lib/auth'
import { uploadViaPool } from '@/lib/gdrive-pool/migrate-modal'
import { getDriveClient } from '@/lib/gdrive-pool/drive-client'
import type { DocumentCategory } from '@/lib/gdrive-pool/types'

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

// Maps document_type → GDrive pool category string
const DOCUMENT_CATEGORY_MAP: Record<string, DocumentCategory> = {
  master_document: 'master_documents',
  admin_order:     'special_orders',
  daily_journal:   'daily_journals',
  library:         'library_items',
}

// Maps document_type → entity_type string used in records table
const ENTITY_TYPE_MAP: Record<string, string> = {
  master_document: 'master_document',
  admin_order:     'special_order',
  daily_journal:   'daily_journal',
  library:         'library_item',
}

/**
 * Fetches a file from the SENDER's Google Drive and re-uploads it to the
 * RECIPIENT's own Drive pool. Returns the new Drive metadata.
 *
 * Falls back gracefully: if the re-upload fails, the caller logs a warning
 * but still proceeds with saving the Supabase metadata using the original URLs.
 */
async function reuploadToRecipientDrive(params: {
  gdriveFileId:    string    // sender's Drive file ID
  poolAccountId:   string    // sender's pool account (used to fetch the file)
  fileName:        string
  mimeType:        string
  fileSizeBytes:   number
  recipientRole:   string    // recipient username → their Drive account
  documentType:    string
  newDocId:        string
}): Promise<{
  fileUrl:       string
  downloadUrl:   string
  previewUrl:    string
  gdriveFileId:  string
  poolAccountId: string
  recordId:      string
  sizeBytes:     number
} | null> {
  try {
    console.log(
      `[ForwardSave] Re-uploading file "${params.fileName}" ` +
      `from pool ${params.poolAccountId} → recipient ${params.recipientRole}`
    )

    // 1. Get the sender's Drive client and download the file bytes
    const senderDrive = await getDriveClient(params.poolAccountId)

    const response = await senderDrive.files.get(
      { fileId: params.gdriveFileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    )

    const fileBuffer = Buffer.from(response.data as ArrayBuffer)
    console.log(
      `[ForwardSave] Downloaded ${fileBuffer.length} bytes ` +
      `(expected ~${params.fileSizeBytes}) from sender's Drive`
    )

    // 2. Upload to the recipient's own Drive pool
    const category   = DOCUMENT_CATEGORY_MAP[params.documentType] ?? 'master_documents'
    const entityType = ENTITY_TYPE_MAP[params.documentType]       ?? params.documentType

    const result = await uploadViaPool({
      file:          fileBuffer,
      fileName:      params.fileName ?? `forwarded-${Date.now()}`,
      mimeType:      params.mimeType,
      category,
      entityType,
      entityId:      params.newDocId,
      uploadedBy:    params.recipientRole,
      fileSizeBytes: fileBuffer.length,
    })

    console.log(
      `[ForwardSave] Re-upload success → gdriveFileId=${result.gdriveFileId}, ` +
      `pool=${result.poolAccountId}, owner=${params.recipientRole}`
    )

    return result
  } catch (err: any) {
    // Non-fatal: log and let caller fall back to original sender URLs
    console.error(
      `[ForwardSave] Re-upload to recipient Drive failed (non-fatal): ${err?.message}`,
      err?.stack
    )
    return null
  }
}

/**
 * Builds a document insert payload tailored to each table's schema.
 * Accepts an optional `driveOverride` that replaces the forwarded doc's
 * Drive references with the recipient's own uploaded copy.
 */
function buildDocumentPayload(
  fwd: any,
  uploaderRole: string,
  driveOverride?: {
    fileUrl:       string
    downloadUrl:   string
    gdriveFileId:  string
    poolAccountId: string
    recordId:      string
    sizeBytes:     number
  } | null
): Record<string, any> {
  // Prefer the recipient's own Drive copy; fall back to sender's references
  const gdriveFileId  = driveOverride?.gdriveFileId  ?? fwd.gdrive_file_id  ?? null
  const gdriveUrl     = driveOverride?.fileUrl        ?? fwd.gdrive_url      ?? null
  const poolAccountId = driveOverride?.poolAccountId  ?? fwd.pool_account_id ?? null
  const sizeBytes     = driveOverride?.sizeBytes      ?? fwd.file_size_bytes ?? 0

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
        id:    `md-${Date.now()}`,
        title: fwd.title,
        level: 'REGIONAL',
        type:  fwd.mime_type?.includes('pdf')   ? 'PDF'
             : fwd.mime_type?.includes('word')  ? 'DOCX'
             : fwd.mime_type?.includes('sheet') ? 'XLSX'
             : 'PDF',
        date:  new Date().toISOString().split('T')[0],
        size:  sizeBytes ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB` : '0 MB',
        tag:   'COMPLIANCE',
        file_url: gdriveUrl,
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
        file_url:    gdriveUrl,
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
        file_url:    gdriveUrl,
        ...driveFields,
      }

    case 'library':
      return {
        id:          `lib-${Date.now()}`,
        title:       fwd.title,
        category:    'TEMPLATE',
        size:        sizeBytes ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB` : '0 MB',
        date_added:  new Date().toISOString(),
        file_url:    gdriveUrl,
        ...driveFields,
      }

    default:
      return {
        title:    fwd.title,
        file_url: gdriveUrl,
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

  // 2. Re-upload the file to the RECIPIENT'S own Google Drive
  //    (only if the forwarded doc has a valid Drive file reference)
  let driveResult: Awaited<ReturnType<typeof reuploadToRecipientDrive>> = null

  if (fwd.gdrive_file_id && fwd.pool_account_id && fwd.mime_type) {
    // Generate the new doc ID first so the Drive record links correctly
    const previewDocId =
      fwd.document_type === 'master_document' ? `md-${Date.now()}`
      : fwd.document_type === 'admin_order'   ? `so-${Date.now()}`
      : fwd.document_type === 'daily_journal' ? `dj-${Date.now()}`
      : `lib-${Date.now()}`

    driveResult = await reuploadToRecipientDrive({
      gdriveFileId:  fwd.gdrive_file_id,
      poolAccountId: fwd.pool_account_id,
      fileName:      fwd.file_name ?? fwd.title,
      mimeType:      fwd.mime_type,
      fileSizeBytes: fwd.file_size_bytes ?? 0,
      recipientRole: profile.role,
      documentType:  fwd.document_type,
      newDocId:      previewDocId,
    })

    if (!driveResult) {
      console.warn(
        `[ForwardSave] Drive re-upload failed for forwarded doc ${id}. ` +
        `Proceeding with sender's Drive references as fallback.`
      )
    }
  } else {
    console.warn(
      `[ForwardSave] Forwarded doc ${id} is missing gdrive_file_id, ` +
      `pool_account_id, or mime_type — skipping Drive re-upload.`
    )
  }

  // 3. Build the Supabase payload (uses recipient's Drive URLs if re-upload succeeded)
  const payload = buildDocumentPayload(fwd, profile.role, driveResult)

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

  // 4. Re-upload and insert attachments (non-fatal if they fail)
  const attachments = fwd.forwarded_attachments ?? []
  if (attachments.length > 0 && attachmentTable && attachmentFk) {
    for (const att of attachments) {
      // Try to re-upload each attachment to the recipient's Drive
      let attDriveResult: Awaited<ReturnType<typeof reuploadToRecipientDrive>> = null

      if (att.gdrive_file_id && att.pool_account_id && att.mime_type) {
        attDriveResult = await reuploadToRecipientDrive({
          gdriveFileId:  att.gdrive_file_id,
          poolAccountId: att.pool_account_id,
          fileName:      att.file_name ?? att.title,
          mimeType:      att.mime_type,
          fileSizeBytes: att.file_size_bytes ?? 0,
          recipientRole: profile.role,
          documentType:  fwd.document_type,
          newDocId:      newDoc.id,
        })
      }

      const { error: attError } = await supabase
        .from(attachmentTable)
        .insert({
          [attachmentFk]:  newDoc.id,
          title:           att.title,
          file_name:       att.file_name   ?? null,
          file_size_bytes: attDriveResult?.sizeBytes ?? att.file_size_bytes ?? null,
          mime_type:       att.mime_type   ?? null,
          gdrive_file_id:  attDriveResult?.gdriveFileId  ?? att.gdrive_file_id,
          gdrive_url:      attDriveResult?.fileUrl       ?? att.gdrive_url,
          pool_account_id: attDriveResult?.poolAccountId ?? att.pool_account_id,
          parent_id:       att.parent_attachment_id ?? null,
          depth:           att.depth ?? 0,
        })

      if (attError) {
        console.error('Attachment save error (non-fatal):', attError.message)
      }
    }
  }

  // 5. Mark forwarded record as saved
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
    success:         true,
    savedDocId:      newDoc.id,
    table:           targetTable,
    driveReupload:   driveResult ? 'success' : 'fallback_to_sender_drive',
    recipientDriveId: driveResult?.gdriveFileId ?? null,
  })
}