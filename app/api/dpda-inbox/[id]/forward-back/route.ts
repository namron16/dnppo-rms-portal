// app/api/dpda-inbox/[id]/forward-back/route.ts
// Forward document back to original sender (e.g. P2) after DPDA review.
//
// ROOT CAUSE FIX:
//   The previous version only updated dpda_status on the DPDA's own
//   forwarded_documents row. It never created or restored a row for the
//   original sender (P2). P2's inbox query filters by status = 'pending',
//   so they never saw the returned document.
//
//   Fix: after marking the DPDA row as returned, INSERT a new
//   forwarded_documents row for the original sender with status = 'pending',
//   copying all document metadata plus the dpda decision fields so P2 can
//   see the outcome (approved / disapproved / returned_with_comments).
//
// PREVIOUS FIXES (kept):
//   - status column NOT set to 'returned' (CHECK constraint violation)
//   - DPDO role allowed alongside DPDA
//   - Surfaces real DB error message on failure

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { setCurrentLogger, logAction } from '@/lib/adminLogger'
import { AdminRole } from '@/lib/auth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (!user || authError) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  if (!profile || !['DPDA', 'DPDO'].includes(profile.role)) {
    return NextResponse.json({ error: 'Only DPDA/DPDO can forward back' }, { status: 403 })
  }

  setCurrentLogger(profile.role as AdminRole, user.id)

  try {
    // 1. Fetch the DPDA's forwarded_documents row (with attachments)
    const { data: fwdDoc, error: fetchError } = await supabase
      .from('forwarded_documents')
      .select('*, forwarded_attachments(*)')
      .eq('id', id)
      .eq('recipient_role', profile.role)
      .single()

    if (fetchError || !fwdDoc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // 2. Mark the DPDA row as returned.
    // Only update dpda_status — the status column CHECK constraint only allows
    // 'pending' | 'saved' | 'dismissed', so we must NOT write 'returned' there.
    const { data: updated, error: updateError } = await supabase
      .from('forwarded_documents')
      .update({
        dpda_status:  'returned',
        returned_at:  new Date().toISOString(),
        returned_by:  user.id,
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError || !updated) {
      const detail = updateError?.message ?? 'Unknown database error'
      console.error('[ForwardBack] DPDA row update failed:', detail)
      return NextResponse.json(
        { error: `Failed to update DPDA review status: ${detail}` },
        { status: 500 }
      )
    }

    // 3. Re-insert a NEW pending row for the original sender.
    // This is what actually puts the document back in P2's inbox.
    // We copy all file metadata and carry over DPDA's decision fields
    // so P2 can see the outcome (approved / disapproved / with comments).
    const { data: returnedRow, error: insertError } = await supabase
      .from('forwarded_documents')
      .insert({
        sender_role:           profile.role,         // DPDA is now the sender
        recipient_role:        fwdDoc.sender_role,   // original sender (P2) is now recipient
        original_doc_id:       fwdDoc.original_doc_id,
        document_type:         fwdDoc.document_type,
        title:                 fwdDoc.title,
        notes:                 fwdDoc.notes               ?? null,
        gdrive_file_id:        fwdDoc.gdrive_file_id,
        gdrive_url:            fwdDoc.gdrive_url,
        pool_account_id:       fwdDoc.pool_account_id,
        file_name:             fwdDoc.file_name            ?? null,
        file_size_bytes:       fwdDoc.file_size_bytes      ?? null,
        mime_type:             fwdDoc.mime_type             ?? null,
        priority:              fwdDoc.priority              ?? 'medium',
        status:                'pending',                  // shows up in P2's inbox immediately
        dpda_status:           fwdDoc.dpda_status,         // carries DPDA's decision
        dpda_comments:         fwdDoc.dpda_comments        ?? '[]',
        dpda_reviewed_at:      fwdDoc.dpda_reviewed_at     ?? null,
        dpda_reviewed_by:      fwdDoc.dpda_reviewed_by     ?? null,
        dpda_rejection_reason: fwdDoc.dpda_rejection_reason ?? null,
      })
      .select()
      .single()

    if (insertError || !returnedRow) {
      const detail = insertError?.message ?? 'Unknown database error'
      console.error('[ForwardBack] Return row insert failed:', detail)
      return NextResponse.json(
        { error: `Document status updated but failed to deliver to sender inbox: ${detail}` },
        { status: 500 }
      )
    }

    // 4. Copy attachments to the new row (non-fatal if it fails)
    const attachments = fwdDoc.forwarded_attachments ?? []
    if (attachments.length > 0) {
      const attRows = attachments.map((att: any) => ({
        forwarded_document_id:  returnedRow.id,
        original_attachment_id: att.original_attachment_id ?? att.id,
        parent_attachment_id:   att.parent_attachment_id   ?? null,
        depth:                  att.depth ?? 0,
        title:                  att.title,
        file_name:              att.file_name       ?? null,
        file_size_bytes:        att.file_size_bytes  ?? null,
        mime_type:              att.mime_type        ?? null,
        gdrive_file_id:         att.gdrive_file_id,
        gdrive_url:             att.gdrive_url,
        pool_account_id:        att.pool_account_id,
      }))

      const { error: attError } = await supabase
        .from('forwarded_attachments')
        .insert(attRows)

      if (attError) {
        console.warn('[ForwardBack] Attachment copy failed (non-fatal):', attError.message)
      }
    }

    // 5. Audit log + notification
    await logAction('DPDA Forwarded Document Back', {
      documentId:    fwdDoc.original_doc_id,
      forwardedId:   id,
      returnedRowId: returnedRow.id,
      documentTitle: fwdDoc.title,
      recipient:     fwdDoc.sender_role,
      dpdaStatus:    fwdDoc.dpda_status,
    })

    const statusLabel =
      fwdDoc.dpda_status === 'approved'    ? 'Approved'
      : fwdDoc.dpda_status === 'disapproved' ? 'Disapproved'
      : 'Reviewed'

    try {
      await supabase.from('notifications').insert({
        recipient_role: fwdDoc.sender_role,
        type:           'document_returned_from_dpda',
        title:          `Document Returned: ${fwdDoc.title}`,
        message:        `DPDA has reviewed and returned your document with status: ${statusLabel}. Check your inbox.`,
        document_id:    fwdDoc.original_doc_id,
        document_type:  fwdDoc.document_type,
        related_id:     returnedRow.id,
        is_read:        false,
        created_at:     new Date().toISOString(),
      })
    } catch (err) {
      console.warn('[ForwardBack] Notification insert failed (non-fatal):', err)
    }

    return NextResponse.json({
      success:       true,
      data:          updated,
      returnedRowId: returnedRow.id,
      message:       'Document forwarded back to sender successfully',
    })
  } catch (error) {
    console.error('[ForwardBack] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}