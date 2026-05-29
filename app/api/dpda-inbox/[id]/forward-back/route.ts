// app/api/dpda-inbox/[id]/forward-back/route.ts
// Forward document back to sender with DPDA's decision and comments
//
// FIXES APPLIED (this revision):
//  1. Removed `status: 'returned'` from the DB update.
//     The forwarded_documents.status column has a CHECK constraint:
//       status IN ('pending', 'saved', 'dismissed')
//     Writing 'returned' violates the constraint and causes a 500.
//     Only dpda_status needs to be set to 'returned' — that column
//     has no such restriction (it's a plain VARCHAR with no CHECK).
//  2. Surfaced the Supabase updateError.message in the 500 response
//     so the client sees the real reason instead of a generic message.
//
// PREVIOUS FIXES (kept):
//  3. Also updates dpda_status → 'returned' so the UI's check works.
//  4. DPDO role allowed alongside DPDA.
//  5. recipient_role filter uses profile.role to support both roles.

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
    const { data: fwdDoc, error: fetchError } = await supabase
      .from('forwarded_documents')
      .select('*')
      .eq('id', id)
      .eq('recipient_role', profile.role)
      .single()

    if (fetchError || !fwdDoc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    const { data: updated, error: updateError } = await supabase
      .from('forwarded_documents')
      .update({
        // FIX: Removed `status: 'returned'` — the status column has a CHECK
        // constraint limiting it to ('pending', 'saved', 'dismissed').
        // Writing 'returned' causes a Postgres constraint violation → 500.
        // dpda_status has no such restriction, so it's safe to set here.
        dpda_status: 'returned',
        returned_at: new Date().toISOString(),
        returned_by: user.id,
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError || !updated) {
      // FIX: Surface the real DB error so the client can display it
      const detail = updateError?.message ?? 'Unknown database error'
      console.error('[ForwardBack] Update failed:', detail)
      return NextResponse.json(
        { error: `Failed to forward back: ${detail}` },
        { status: 500 }
      )
    }

    await logAction('DPDA Forwarded Document Back', {
      documentId:  fwdDoc.original_doc_id,
      forwardedId: id,
      documentTitle: fwdDoc.title,
      recipient:   fwdDoc.sender_role,
      dpdaStatus:  fwdDoc.dpda_status,
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
        message:        `DPDA has reviewed and returned your document with status: ${statusLabel}`,
        document_id:    fwdDoc.original_doc_id,
        document_type:  fwdDoc.document_type,
        related_id:     id,
        is_read:        false,
        created_at:     new Date().toISOString(),
      })
    } catch (err) {
      console.error('[ForwardBack] Notification insert failed (non-fatal):', err)
    }

    return NextResponse.json({
      success: true,
      data:    updated,
      message: 'Document forwarded back to sender successfully',
    })
  } catch (error) {
    console.error('[ForwardBack] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}