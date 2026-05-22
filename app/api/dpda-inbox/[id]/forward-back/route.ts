// app/api/dpda-inbox/[id]/forward-back/route.ts
// Forward document back to sender with DPDA's decision and comments
//
// FIXES APPLIED:
//  1. Now also updates dpda_status → 'returned' so the UI's
//     dpda_status === 'returned' check in FileDetailsModal works correctly.
//     Previously only the base `status` column was updated, so the modal
//     still showed the "Forward Back" button after forwarding.
//  2. Removed unused `status` body param (was accepted but never used).
//  3. DPDO role now allowed alongside DPDA (was DPDA-only, inconsistent with README).
//  4. recipient_role filter uses profile.role to support both DPDA and DPDO.

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

  // FIX: Allow DPDO as well as DPDA (was DPDA-only, inconsistent with README and GET route)
  if (!profile || !['DPDA', 'DPDO'].includes(profile.role)) {
    return NextResponse.json({ error: 'Only DPDA/DPDO can forward back' }, { status: 403 })
  }

  setCurrentLogger(profile.role as AdminRole, user.id)

  try {
    const { data: fwdDoc, error: fetchError } = await supabase
      .from('forwarded_documents')
      .select('*')
      .eq('id', id)
      // FIX: Use profile.role so DPDO can also forward back their own documents
      .eq('recipient_role', profile.role)
      .single()

    if (fetchError || !fwdDoc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    const { data: updated, error: updateError } = await supabase
      .from('forwarded_documents')
      .update({
        status: 'returned',
        // FIX: Also update dpda_status → 'returned' so the UI reflects the correct state.
        // Previously only `status` was updated; `dpda_status` stayed as 'approved'/'disapproved',
        // so FileDetailsModal kept showing the "Forward Back" button indefinitely.
        dpda_status: 'returned',
        returned_at: new Date().toISOString(),
        returned_by: user.id,
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: 'Failed to forward back' }, { status: 500 })
    }

    await logAction('DPDA Forwarded Document Back', {
      documentId: fwdDoc.original_doc_id,
      forwardedId: id,
      documentTitle: fwdDoc.title,
      recipient: fwdDoc.sender_role,
      dpdaStatus: fwdDoc.dpda_status,
    })

    const statusLabel =
      fwdDoc.dpda_status === 'approved'
        ? 'Approved'
        : fwdDoc.dpda_status === 'disapproved'
          ? 'Disapproved'
          : 'Reviewed'

    try {
      await supabase.from('notifications').insert({
        recipient_role: fwdDoc.sender_role,
        type: 'document_returned_from_dpda',
        title: `Document Returned: ${fwdDoc.title}`,
        message: `DPDA has reviewed and returned your document with status: ${statusLabel}`,
        document_id: fwdDoc.original_doc_id,
        document_type: fwdDoc.document_type,
        related_id: id,
        is_read: false,
        created_at: new Date().toISOString(),
      })
    } catch (err) {
      console.error(err)
    }

    return NextResponse.json({
      success: true,
      data: updated,
      message: 'Document forwarded back to sender successfully',
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}