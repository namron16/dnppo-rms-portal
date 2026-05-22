// app/api/dpda-inbox/[id]/approve/route.ts
// Approve a forwarded document
//
// FIXES APPLIED:
//  1. dpda_comments now stored as a JSONB array (JSON.stringify'd),
//     not a raw string. The migration defines the column as JSONB DEFAULT '[]',
//     so writing a plain string risks a type error or silent coercion.
//  2. DPDO role now allowed alongside DPDA (was blocked despite README stating both have access).

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
    return NextResponse.json({ error: 'Only DPDA/DPDO can approve documents' }, { status: 403 })
  }

  setCurrentLogger(profile.role as AdminRole, user.id)

  const body = await req.json()
  const { comments = '' } = body

  // FIX: Build dpda_comments as a JSONB-compatible array instead of a raw string.
  // The column is defined as JSONB DEFAULT '[]' in the migration.
  // Storing a plain string would either throw or silently coerce, and would break
  // the comment route's JSON.parse() when reading existing comments later.
  const commentsArray = comments.trim()
    ? [
        {
          text: comments,
          author: profile.display_name || profile.role,
          timestamp: new Date().toISOString(),
          action: 'approved',
        },
      ]
    : []

  try {
    const { data: updated, error: updateError } = await supabase
      .from('forwarded_documents')
      .update({
        dpda_status: 'approved',
        dpda_reviewed_by: user.id,
        dpda_reviewed_at: new Date().toISOString(),
        // FIX: Store as JSON string of an array, not a raw string
        dpda_comments: JSON.stringify(commentsArray),
      })
      .eq('id', id)
      .eq('recipient_role', profile.role)
      .select()
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: 'Failed to approve document' }, { status: 500 })
    }

    await logAction('DPDA Approved Document', {
      documentId: updated.original_doc_id,
      forwardedId: id,
      documentTitle: updated.title,
      sender: updated.sender_role,
      comments: comments.substring(0, 100),
    })

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
      .then(() => {})

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