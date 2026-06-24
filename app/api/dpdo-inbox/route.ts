// app/api/dpdo-inbox/route.ts
// Fetch forwarded documents for DPDO review only
// Same structure as dpda-inbox but recipient_role = 'DPDO'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
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

  // FIX: DPDO only — DPDA has its own route
  if (!profile || profile.role !== 'DPDO') {
    return NextResponse.json({ error: 'Only DPDO can access this' }, { status: 403 })
  }

  const url = new URL(req.url)
  const statusParam  = url.searchParams.get('status') || ''
  const search       = url.searchParams.get('search') || ''
  const sender       = url.searchParams.get('sender') || ''
  const priority     = url.searchParams.get('priority') || ''
  const sort         = url.searchParams.get('sort') || 'date-desc'
  const limit        = parseInt(url.searchParams.get('limit') || '12')
  const offset       = parseInt(url.searchParams.get('offset') || '0')

  try {
    const STATUSES = ['pending', 'approved', 'disapproved', 'returned', 'returned_with_comments'] as const

    const statusCountsPromise = Promise.all(
      STATUSES.map(async (s) => {
        const { count } = await supabase
          .from('forwarded_documents')
          .select('*', { count: 'exact', head: true })
          .eq('recipient_role', 'DPDO')   // ← scoped to DPDO only
          .eq('dpda_status', s)
        return { status: s, count: count ?? 0 }
      })
    ).then((results) => {
      const counts: Record<string, number> = {}
      for (const r of results) counts[r.status] = r.count
      return counts
    })

    let query = supabase
      .from('forwarded_documents')
      .select(`
        id, sender_role, recipient_role, original_doc_id,
        document_type, title, notes, gdrive_file_id, gdrive_url,
        pool_account_id, file_name, file_size_bytes, mime_type,
        status, priority, received_at, created_at,
        dpda_status, dpda_comments, dpda_reviewed_at,
        forwarded_attachments(
          id, title, file_name, file_size_bytes,
          mime_type, gdrive_file_id, gdrive_url, depth
        )
      `, { count: 'exact' })
      .eq('recipient_role', 'DPDO')   // ← scoped to DPDO only

    if (statusParam && statusParam !== 'all') query = query.eq('dpda_status', statusParam)
    if (sender)   query = query.eq('sender_role', sender)
    if (priority) query = query.eq('priority', priority)
    if (search)   query = query.or(`title.ilike.%${search}%,notes.ilike.%${search}%`)

    switch (sort) {
      case 'date-asc':      query = query.order('created_at', { ascending: true }); break
      case 'priority-high': query = query.order('priority', { ascending: false }).order('created_at', { ascending: false }); break
      case 'sender':        query = query.order('sender_role', { ascending: true }); break
      default:              query = query.order('created_at', { ascending: false })
    }

    query = query.range(offset, offset + limit - 1)

    const [{ data, count, error }, statusCounts] = await Promise.all([query, statusCountsPromise])

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 })
    }

    return NextResponse.json({
      data:         data || [],
      count:        count || 0,
      total:        count || 0,
      statusCounts,
    })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}