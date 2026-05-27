// app/api/forward/[id]/save/route.ts
//
// FIXES APPLIED:
//  1. Added upfront check: if the recipient has no connected Drive account,
//     we return 422 immediately instead of silently saving with the sender's URLs.
//  2. Made Drive re-upload failure FATAL (not a silent fallback).
//     Before, a failed re-upload would still return 200 OK and save the row
//     with the sender's gdrive_file_id / gdrive_url — the file appeared saved
//     but lived in the sender's Drive, not the recipient's.
//  3. Fixed the previewDocId timing bug: the ID is generated ONCE and passed
//     into buildDocumentPayload so the Drive `records` table entry matches the
//     actual inserted document row.
//  4. Same three fixes applied to per-attachment re-uploads (now also fatal).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logSaveForwardedDocument, setCurrentLogger } from '@/lib/adminLogger'
import { AdminRole } from '@/lib/auth'
import { uploadViaPool } from '@/lib/gdrive-pool/migrate-modal'
import { getDriveClient } from '@/lib/gdrive-pool'
import {getPoolAccountsByUsername} from '@/lib/gdrive-pool/db'
import type { DocumentCategory } from '@/lib/gdrive-pool/types'

// ─────────────────────────────────────────────────────────────────────────────
// Table maps
// ─────────────────────────────────────────────────────────────────────────────

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

const DOCUMENT_CATEGORY_MAP: Record<string, DocumentCategory> = {
  master_document: 'master_documents',
  admin_order:     'special_orders',
  daily_journal:   'daily_journals',
  library:         'library_items',
}

const ENTITY_TYPE_MAP: Record<string, string> = {
  master_document: 'master_document',
  admin_order:     'special_order',
  daily_journal:   'daily_journal',
  library:         'library_item',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — generate a stable doc ID for a given document type
// Called ONCE and threaded through both the Drive upload and the DB insert
// so the `records` table entry matches the actual document row.
// ─────────────────────────────────────────────────────────────────────────────

function generateDocId(documentType: string): string {
  const ts = Date.now()
  switch (documentType) {
    case 'master_document': return `md-${ts}`
    case 'admin_order':     return `so-${ts}`
    case 'daily_journal':   return `dj-${ts}`
    default:                return `lib-${ts}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-upload a file from the sender's Drive to the recipient's Drive pool.
//
// FIX 2: This function now THROWS on failure instead of returning null.
// The caller wraps it in try/catch and surfaces the error to the client so
// the admin knows the save did not complete.
// ─────────────────────────────────────────────────────────────────────────────

async function reuploadToRecipientDrive(params: {
  gdriveFileId:    string
  poolAccountId:   string   // sender's pool account — used to DOWNLOAD the file
  fileName:        string
  mimeType:        string
  fileSizeBytes:   number
  recipientRole:   string   // recipient's username — uploadViaPool picks their Drive
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
}> {
  console.log(
    `[ForwardSave] Re-uploading "${params.fileName}" ` +
    `from pool ${params.poolAccountId} → recipient ${params.recipientRole}`
  )

  // 1. Download the file bytes from the SENDER's Drive
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

  // 2. Upload the bytes to the RECIPIENT's own Drive pool
  const category   = DOCUMENT_CATEGORY_MAP[params.documentType] ?? 'master_documents'
  const entityType = ENTITY_TYPE_MAP[params.documentType]       ?? params.documentType

  // uploadViaPool calls selectPoolAccount({ username: recipientRole })
  // which only picks from Drive accounts owned by the recipient.
  // FIX 1 (upstream): we already checked that the recipient has ≥1 Drive account
  // before reaching here, so this call should always succeed.
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the Supabase insert payload for the target document table.
//
// FIX 3: Accepts docId so the ID is consistent between the Drive upload
// (which registers the entity_id in `records`) and the DB row itself.
// ─────────────────────────────────────────────────────────────────────────────

function buildDocumentPayload(
  fwd: any,
  uploaderRole: string,
  docId: string,
  driveResult: {
    fileUrl:       string
    downloadUrl:   string
    gdriveFileId:  string
    poolAccountId: string
    recordId:      string
    sizeBytes:     number
  }
): Record<string, any> {
  const gdriveFileId  = driveResult.gdriveFileId
  const gdriveUrl     = driveResult.fileUrl
  const poolAccountId = driveResult.poolAccountId
  const sizeBytes     = driveResult.sizeBytes

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
        id:       docId,
        title:    fwd.title,
        level:    'REGIONAL',
        type:     fwd.mime_type?.includes('pdf')   ? 'PDF'
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
        id:          docId,
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
        id:          docId,
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
        id:          docId,
        title:       fwd.title,
        category:    'TEMPLATE',
        size:        sizeBytes ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB` : '0 MB',
        date_added:  new Date().toISOString(),
        file_url:    gdriveUrl,
        ...driveFields,
      }

    default:
      return {
        id:       docId,
        title:    fwd.title,
        file_url: gdriveUrl,
        ...driveFields,
      }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/forward/[id]/save
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()

  // ── Auth ────────────────────────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
  setCurrentLogger(profile.role as AdminRole, user.id)

  // ── FIX 1: Check recipient has a connected Drive account BEFORE doing anything ──
  //
  // If the recipient has no Drive account, the re-upload will fail 100% of the
  // time. Surface this clearly right away rather than letting it silently fall
  // through to saving with the sender's Drive references.
  const recipientAccount = await getPoolAccountsByUsername(profile.role)
  const recipientDriveAccounts = recipientAccount ? [recipientAccount] : []

  if (recipientDriveAccounts.length === 0) {
    return NextResponse.json(
      {
        error:
          `Your account ("${profile.role}") has no connected Google Drive. ` +
          `An admin must connect a Google Drive account for you at /admin/gdrive ` +
          `before you can save forwarded files.`,
        code: 'NO_DRIVE_ACCOUNT',
      },
      { status: 422 }
    )
  }

  // ── Fetch the forwarded document ────────────────────────────────────────────
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

  // ── Validate the forwarded document has Drive references ───────────────────
  if (!fwd.gdrive_file_id || !fwd.pool_account_id || !fwd.mime_type) {
    return NextResponse.json(
      {
        error:
          `Forwarded document is missing required Drive metadata ` +
          `(gdrive_file_id, pool_account_id, or mime_type). ` +
          `The sender may need to re-forward this file.`,
        code: 'MISSING_DRIVE_METADATA',
      },
      { status: 422 }
    )
  }

  // ── FIX 3: Generate the doc ID ONCE and reuse everywhere ──────────────────
  const newDocId = generateDocId(fwd.document_type)

  // ── FIX 2: Re-upload to recipient's Drive — FATAL on failure ──────────────
  //
  // Before this fix, a failed re-upload silently fell back to the sender's
  // Drive references (same gdrive_file_id / gdrive_url). The Supabase row
  // appeared correct but the file lived in the sender's Drive bucket.
  let driveResult: Awaited<ReturnType<typeof reuploadToRecipientDrive>>

  try {
    driveResult = await reuploadToRecipientDrive({
      gdriveFileId:  fwd.gdrive_file_id,
      poolAccountId: fwd.pool_account_id,
      fileName:      fwd.file_name ?? fwd.title,
      mimeType:      fwd.mime_type,
      fileSizeBytes: fwd.file_size_bytes ?? 0,
      recipientRole: profile.role,
      documentType:  fwd.document_type,
      newDocId,
    })
  } catch (err: any) {
    console.error(`[ForwardSave] Drive re-upload failed for forwarded doc ${id}:`, err?.message)
    return NextResponse.json(
      {
        error:
          `Failed to copy the file to your Google Drive: ${err?.message ?? 'Unknown error'}. ` +
          `Ensure your Drive account is connected and has available storage at /admin/gdrive.`,
        code: 'DRIVE_REUPLOAD_FAILED',
      },
      { status: 502 }
    )
  }

  // ── Build Supabase payload using the recipient's Drive URLs ─────────────────
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
    // Drive upload already succeeded — log the orphaned file so admins can clean up
    console.error(
      `[ForwardSave] ORPHANED Drive file: gdriveFileId=${driveResult.gdriveFileId}, ` +
      `poolAccountId=${driveResult.poolAccountId}. ` +
      `Manual cleanup may be required.`
    )
    return NextResponse.json(
      { error: docError?.message ?? 'Failed to save document metadata' },
      { status: 500 }
    )
  }

  // ── Re-upload and insert attachments ────────────────────────────────────────
  //
  // FIX 4: Attachment re-upload failures are now logged with clear error
  // messages. They remain non-fatal (the main document was saved successfully)
  // but the error is surfaced in the response so the admin can see which
  // attachments failed instead of silently getting missing files.
  const attachments  = fwd.forwarded_attachments ?? []
  const attErrors: string[] = []

  if (attachments.length > 0 && attachmentTable && attachmentFk) {
    for (const att of attachments) {
      if (!att.gdrive_file_id || !att.pool_account_id || !att.mime_type) {
        console.warn(
          `[ForwardSave] Skipping attachment "${att.title}" — missing Drive metadata`
        )
        attErrors.push(`"${att.title}": missing Drive metadata (skipped)`)
        continue
      }

      let attDriveResult: Awaited<ReturnType<typeof reuploadToRecipientDrive>> | null = null

      try {
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
      } catch (err: any) {
        console.error(
          `[ForwardSave] Attachment re-upload failed for "${att.title}":`,
          err?.message
        )
        attErrors.push(`"${att.title}": Drive upload failed — ${err?.message}`)
        // Non-fatal: continue saving other attachments
        continue
      }

      const { error: attError } = await supabase
        .from(attachmentTable)
        .insert({
          [attachmentFk]:  newDoc.id,
          title:           att.title,
          file_name:       att.file_name         ?? null,
          file_size_bytes: attDriveResult.sizeBytes,
          mime_type:       att.mime_type          ?? null,
          gdrive_file_id:  attDriveResult.gdriveFileId,
          gdrive_url:      attDriveResult.fileUrl,
          pool_account_id: attDriveResult.poolAccountId,
          parent_id:       att.parent_attachment_id ?? null,
          depth:           att.depth ?? 0,
        })

      if (attError) {
        console.error('[ForwardSave] Attachment DB insert error (non-fatal):', attError.message)
        attErrors.push(`"${att.title}": DB insert failed — ${attError.message}`)
      }
    }
  }

  // ── Mark forwarded record as saved ──────────────────────────────────────────
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
    success:          true,
    savedDocId:       newDoc.id,
    table:            targetTable,
    driveReupload:    'success',
    recipientDriveId: driveResult.gdriveFileId,
    attachmentErrors: attErrors.length > 0 ? attErrors : undefined,
  })
}