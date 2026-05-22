// app/api/dpda-inbox/[id]/disapprove/route.ts
// Disapprove a forwarded document
//
// FIXES APPLIED:
//  1. dpda_comments now stored as a JSONB array (JSON.stringify'd),
//     not a raw string. Matches column definition (JSONB DEFAULT '[]') and
//     prevents breaking the comment route's JSON.parse() on subsequent reads.
//  2. DPDO role now allowed alongside DPDA (was blocked despite README and GET route allowing it).

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
    return NextResponse.json({ error: 'Only DPDA/DPDO can disapprove documents' }, { status: 403 })
  }

  setCurrentLogger(profile.role as AdminRole, user.id)

  const body = await req.json()
  const { comments = '', reason = '' } = body

  // FIX: Build dpda_comments as a JSONB-compatible array.
  // Storing a raw string into a JSONB column can cause type errors or silent coercion,
  // and breaks the comment route's JSON.parse() when appending further comments.
  const commentsArray = comments.trim()
    ? [
        {
          text: comments,
          author: profile.display_name || profile.role,
          timestamp: new Date().toISOString(),
          action: 'disapproved',
        },
      ]
    : []

  try {
    const { data: updated, error: updateError } = await supabase
      .from('forwarded_documents')
      .update({
        dpda_status: 'disapproved',
        dpda_reviewed_by: user.id,
        dpda_reviewed_at: new Date().toISOString(),
        // FIX: Store as JSON string of an array, not a raw string
        dpda_comments: JSON.stringify(commentsArray),
        dpda_rejection_reason: reason,
      })
      .eq('id', id)
      .eq('recipient_role', profile.role)
      .select()
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: 'Failed to disapprove document' }, { status: 500 })
    }

    await logAction('DPDA Disapproved Document', {
      documentId: updated.original_doc_id,
      forwardedId: id,
      documentTitle: updated.title,
      sender: updated.sender_role,
      reason: reason.substring(0, 100),
    })

    try {
      await supabase.from('notifications').insert({
        recipient_role: updated.sender_role,
        type: 'document_disapproved',
        title: `Document Disapproved: ${updated.title}`,
        message: `DPDA has disapproved your forwarded document. Please review the feedback.`,
        document_id: updated.original_doc_id,
        document_type: updated.document_type,
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
      message: 'Document disapproved successfully',
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}