// app/api/dpda-inbox/route.ts
// Fetch forwarded documents for DPDA review
//
// FIXES APPLIED:
//  1. Returns statusCounts object so the page summary cards show accurate totals
//     across ALL documents, not just the current page.
//  2. Changed default limit from 50 → 12 to match ITEMS_PER_PAGE in page.tsx.
//  3. DPDO role already allowed here (was correct); kept as-is.

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
  // FIX: Default limit aligned to ITEMS_PER_PAGE (12) in page.tsx
  const limit = parseInt(url.searchParams.get('limit') || '12')
  const offset = parseInt(url.searchParams.get('offset') || '0')

  try {
    // FIX: Fetch per-status counts in parallel so summary cards show accurate totals
    // across the full dataset, not just the current page.
    const statusCountsPromise = supabase
      .from('forwarded_documents')
      .select('dpda_status', { count: 'exact' })
      .in('recipient_role', ['DPDA', 'DPDO'])
      .then(async () => {
        const statuses = ['pending', 'approved', 'disapproved', 'returned'] as const
        const counts: Record<string, number> = {}
        await Promise.all(
          statuses.map(async (s) => {
            const { count } = await supabase
              .from('forwarded_documents')
              .select('*', { count: 'exact', head: true })
              .in('recipient_role', ['DPDA', 'DPDO'])
              .eq('dpda_status', s)
            counts[s] = count ?? 0
          })
        )
        return counts
      })

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

    // Filter by status
    if (statusParam && statusParam !== 'all') {
      query = query.eq('dpda_status', statusParam)
    }

    // Filter by sender
    if (sender) {
      query = query.eq('sender_role', sender)
    }

    // Filter by priority
    if (priority) {
      query = query.eq('priority', priority)
    }

    // Search in title and notes
    if (search) {
      query = query.or(`title.ilike.%${search}%,notes.ilike.%${search}%`)
    }

    // Sorting
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

    // Pagination
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
          statusCounts: { pending: 0, approved: 0, disapproved: 0, returned: 0 },
        })
      }
      console.error('Fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 })
    }

    return NextResponse.json({
      data: data || [],
      count: count || 0,
      total: count || 0,
      // FIX: Include per-status counts so the UI summary cards are accurate
      statusCounts,
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}