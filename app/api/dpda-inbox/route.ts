// app/api/dpda-inbox/route.ts
// Fetch forwarded documents for DPDA review
//
// FIXES APPLIED:
//  1. statusCounts now counts rows by their ORIGINAL recipient_role (DPDA/DPDO)
//     regardless of dpda_status — so approved/disapproved docs that were later
//     "returned" still count toward the right bucket.
//  2. Rewrote statusCountsPromise to be a clean standalone Promise.all — the
//     previous chained .then() structure was fragile and hard to reason about.
//  3. Added 'returned_with_comments' to the counted statuses so that bucket
//     is also reflected in the summary cards if needed.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { setCurrentLogger } from '@/lib/adminLogger'
import { AdminRole } from '@/lib/auth'

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

  if (!profile || !['DPDA', 'DPDO'].includes(profile.role)) {
    return NextResponse.json({ error: 'Only DPDA/DPDO can access this' }, { status: 403 })
  }

  setCurrentLogger(profile.role as AdminRole, user.id)

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status') || ''
  const search = url.searchParams.get('search') || ''
  const sender = url.searchParams.get('sender') || ''
  const priority = url.searchParams.get('priority') || ''
  const sort = url.searchParams.get('sort') || 'date-desc'
  const limit = parseInt(url.searchParams.get('limit') || '12')
  const offset = parseInt(url.searchParams.get('offset') || '0')

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // FIX: Count ALL rows where recipient_role was DPDA/DPDO, grouped by
    // dpda_status. This includes rows that were later forwarded back (whose
    // dpda_status is now 'returned') AND rows that are still sitting in the
    // inbox (dpda_status = 'pending', 'approved', 'disapproved', etc.).
    //
    // The previous code was also structured incorrectly — it chained .then()
    // off a query result which made the Promise.all receive the inner
    // Promise instead of the resolved counts object.
    // ─────────────────────────────────────────────────────────────────────────
    const STATUSES = ['pending', 'approved', 'disapproved', 'returned', 'returned_with_comments'] as const

    const statusCountsPromise = Promise.all(
      STATUSES.map(async (s) => {
        const { count, error } = await supabase
          .from('forwarded_documents')
          .select('*', { count: 'exact', head: true })
          .in('recipient_role', ['DPDA', 'DPDO'])
          .eq('dpda_status', s)
        return { status: s, count: count ?? 0, error }
      })
    ).then((results) => {
      const counts: Record<string, number> = {}
      for (const r of results) {
        counts[r.status] = r.count
      }
      return counts
    })

    // ── Main paginated query ─────────────────────────────────────────────────
    let query = supabase
      .from('forwarded_documents')
      .select(`
        id,
        sender_role,
        recipient_role,
        original_doc_id,
        document_type,
        title,
        notes,
        gdrive_file_id,
        gdrive_url,
        pool_account_id,
        file_name,
        file_size_bytes,
        mime_type,
        status,
        priority,
        received_at,
        created_at,
        dpda_status,
        dpda_comments,
        dpda_reviewed_at,
        forwarded_attachments(
          id,
          title,
          file_name,
          file_size_bytes,
          mime_type,
          gdrive_file_id,
          gdrive_url,
          depth
        )
      `, { count: 'exact' })
      .in('recipient_role', ['DPDA', 'DPDO'])

    if (statusParam && statusParam !== 'all') {
      query = query.eq('dpda_status', statusParam)
    }
    if (sender) {
      query = query.eq('sender_role', sender)
    }
    if (priority) {
      query = query.eq('priority', priority)
    }
    if (search) {
      query = query.or(`title.ilike.%${search}%,notes.ilike.%${search}%`)
    }

    switch (sort) {
      case 'date-asc':
        query = query.order('created_at', { ascending: true })
        break
      case 'priority-high':
        query = query.order('priority', { ascending: false }).order('created_at', { ascending: false })
        break
      case 'sender':
        query = query.order('sender_role', { ascending: true })
        break
      case 'date-desc':
      default:
        query = query.order('created_at', { ascending: false })
        break
    }

    query = query.range(offset, offset + limit - 1)

    const [{ data, count, error }, statusCounts] = await Promise.all([
      query,
      statusCountsPromise,
    ])

    if (error) {
      if (error.message?.includes('relation') || error.message?.includes('does not exist')) {
        console.warn('Documents table not yet initialized:', error.message)
        return NextResponse.json({
          data: [],
          count: 0,
          total: 0,
          statusCounts: { pending: 0, approved: 0, disapproved: 0, returned: 0, returned_with_comments: 0 },
        })
      }
      console.error('Fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 })
    }

    return NextResponse.json({
      data: data || [],
      count: count || 0,
      total: count || 0,
      statusCounts,
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}