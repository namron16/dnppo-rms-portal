// app/api/dpda-inbox/[id]/comment/route.ts
// Add comments to a forwarded document

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { setCurrentLogger } from '@/lib/adminLogger'
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
    return NextResponse.json({ error: 'Only DPDA can add comments' }, { status: 403 })
  }

  setCurrentLogger(profile.role as AdminRole, user.id)

  const body = await req.json()
  const { comment = '' } = body

  if (!comment.trim()) {
    return NextResponse.json({ error: 'Comment cannot be empty' }, { status: 400 })
  }

  try {
    // Get the forwarded document
    const { data: fwdDoc } = await supabase
      .from('forwarded_documents')
      .select('dpda_comments')
      .eq('id', id)
      .eq('recipient_role', 'DPDA')
      .single()

    if (!fwdDoc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Append comment to existing comments
    const existingComments = fwdDoc.dpda_comments ? JSON.parse(fwdDoc.dpda_comments) : []
    const updatedComments = [
      ...existingComments,
      {
        text: comment,
        author: profile.display_name || profile.role,
        timestamp: new Date().toISOString(),
      },
    ]

    // Update the document
    const { data: updated, error: updateError } = await supabase
      .from('forwarded_documents')
      .update({
        dpda_comments: JSON.stringify(updatedComments),
        dpda_status: 'returned_with_comments',
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError || !updated) {
      return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: updated,
      message: 'Comment added successfully',
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(
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
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
  }

  try {
    const { data: fwdDoc } = await supabase
      .from('forwarded_documents')
      .select('dpda_comments')
      .eq('id', id)
      .single()

    if (!fwdDoc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    const comments = fwdDoc.dpda_comments ? JSON.parse(fwdDoc.dpda_comments) : []

    return NextResponse.json({
      success: true,
      comments,
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
