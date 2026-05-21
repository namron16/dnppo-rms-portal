// app/api/dpda-inbox/[id]/forward-back/route.ts
// Forward document back to sender with DPDA's decision and comments

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

  if (!profile || profile.role !== 'DPDA') {
    return NextResponse.json({ error: 'Only DPDA can forward back' }, { status: 403 })
  }

  setCurrentLogger(profile.role as AdminRole, user.id)

  const body = await req.json()
  const { status = 'returned' } = body

  try {
    // Get the forwarded document
    const { data: fwdDoc, error: fetchError } = await supabase
      .from('forwarded_documents')
      .select('*')
      .eq('id', id)
      .eq('recipient_role', 'DPDA')
      .single()

    if (fetchError || !fwdDoc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Update status to returned
    const { data: updated, error: updateError } = await supabase
      .from('forwarded_documents')
      .update({
        status: 'returned',
        returned_at: new Date().toISOString(),
        returned_by: user.id,
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: 'Failed to forward back' }, { status: 500 })
    }

    // Log the action
    await logAction('DPDA Forwarded Document Back', {
      documentId: fwdDoc.original_doc_id,
      forwardedId: id,
      documentTitle: fwdDoc.title,
      recipient: fwdDoc.sender_role,
      dpdaStatus: fwdDoc.dpda_status,
    })

    // Create notification for sender
    const statusLabel =
      fwdDoc.dpda_status === 'approved'
        ? 'Approved'
        : fwdDoc.dpda_status === 'disapproved'
          ? 'Disapproved'
          : 'Reviewed'

    await supabase
      .from('notifications')
      .insert({
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
      .then(() => {}) // Silently fail if notification creation fails
      .catch(console.error)

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
