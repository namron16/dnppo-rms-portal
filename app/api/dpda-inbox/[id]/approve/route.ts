// app/api/dpda-inbox/[id]/approve/route.ts
// Approve a forwarded document

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
    return NextResponse.json({ error: 'Only DPDA can approve documents' }, { status: 403 })
  }

  setCurrentLogger(profile.role as AdminRole, user.id)

  const body = await req.json()
  const { comments = '' } = body

  try {
    // Update the forwarded document with approval
    const { data: updated, error: updateError } = await supabase
      .from('forwarded_documents')
      .update({
        dpda_status: 'approved',
        dpda_reviewed_by: user.id,
        dpda_reviewed_at: new Date().toISOString(),
        dpda_comments: comments,
      })
      .eq('id', id)
      .eq('recipient_role', 'DPDA')
      .select()
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: 'Failed to approve document' }, { status: 500 })
    }

    // Log the action
    await logAction('DPDA Approved Document', {
      documentId: updated.original_doc_id,
      forwardedId: id,
      documentTitle: updated.title,
      sender: updated.sender_role,
      comments: comments.substring(0, 100),
    })

    // Trigger notification to sender (you'll implement this via Supabase realtime)
    await supabase
      .from('notifications')
      .insert({
        recipient_role: updated.sender_role,
        type: 'document_approved',
        title: `Document Approved: ${updated.title}`,
        message: `DPDA has approved your forwarded document.`,
        document_id: updated.original_doc_id,
        document_type: updated.document_type,
        related_id: id,
        is_read: false,
        created_at: new Date().toISOString(),
      })
      .then(() => {}) // Silently fail if notification creation fails
      .catch(console.error)

    return NextResponse.json({
      success: true,
      data: updated,
      message: 'Document approved successfully',
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
