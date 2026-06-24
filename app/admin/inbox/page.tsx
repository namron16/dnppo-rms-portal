// app/admin/dpda-inbox/page.tsx
// DPDA Inbox - Main page for reviewing forwarded documents
//
// FIXES APPLIED:
//  1. Moved role guard AFTER all hook declarations (React rules of hooks violation)
//  2. Status count cards now use per-status totals from API (not filtered local page data)
//  3. Removed unused getStatusCount() function (dead code)
//  4. Wired up the attachment download button in desktop table
//  5. NEW: fetchStatusCounts is its own function — the realtime subscription
//     calls it directly instead of re-running the full fetchDocuments, so the
//     summary cards update instantly without reloading the whole table.
//  6. NEW: Second Supabase realtime channel ('dpda_status_counts_realtime')
//     watches ALL changes to forwarded_documents for DPDA/DPDO recipients and
//     refreshes only the status counts — this means approving/rejecting a doc
//     in the modal immediately updates the cards even without a full page reload.
//  7. totalCount now always reflects the UNFILTERED total (a separate state
//     variable) so the "Total Documents" card is always accurate regardless of
//     which status filter is active.
//  8. FIX PAGINATION: Pagination is now always shown when there are documents,
//     even on page 1. Previously hidden when totalPages <= 1, which caused it
//     to disappear when all results fit on one page.

'use client'

import React, { useEffect, useState, useCallback } from 'react'
import {
  Inbox,
  FileText,
  AlertCircle,
  RefreshCw,
  Download,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  MessageCircle,
  TrendingUp,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { DPDAFilterBar } from '@/components/dpda-inbox/DPDAFilterBar'
import { ForwardedFileCard } from '@/components/dpda-inbox/ForwardedFileCard'
import { FileDetailsModal } from '@/components/dpda-inbox/FileDetailsModal'
import type { ForwardedDocument } from '@/components/dpda-inbox/FileDetailsModal'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { supabase } from '@/lib/supabase'

interface StatusCounts {
  pending: number
  approved: number
  disapproved: number
  returned: number
  returned_with_comments: number
}

const ITEMS_PER_PAGE = 12

export default function DPDAInboxPage() {
  
  const { user } = useAuth()
  const inboxApiPath = user?.role === 'DPDO' ? '/api/dpdo-inbox' : '/api/dpda-inbox'
  const [documents, setDocuments] = useState<ForwardedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const [statusCounts, setStatusCounts] = useState<StatusCounts>({
    pending: 0,
    approved: 0,
    disapproved: 0,
    returned: 0,
    returned_with_comments: 0,
  })

  // FIX 7: Separate unfiltered total so "Total Documents" card is always right
  const [unfilteredTotal, setUnfilteredTotal] = useState(0)

  // Filters and pagination
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [senderFilter, setSenderFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [sortBy, setSortBy] = useState('date-desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  // Modal state
  const [selectedDocument, setSelectedDocument] = useState<ForwardedDocument | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // ── FIX 5: Dedicated status-counts fetcher ────────────────────────────────
  const fetchStatusCounts = useCallback(async () => {
    try {
      const res = await fetch(`${inboxApiPath}?limit=1&offset=0&status=all`)
      if (!res.ok) return
      const data = await res.json()
      if (data.statusCounts) {
        setStatusCounts(data.statusCounts)
      }
      if (data.statusCounts) {
        const counts = data.statusCounts as StatusCounts
        const total =
          (counts.pending ?? 0) +
          (counts.approved ?? 0) +
          (counts.disapproved ?? 0) +
          (counts.returned ?? 0) +
          (counts.returned_with_comments ?? 0)
        setUnfilteredTotal(total)
      }
    } catch {
      // Non-fatal
    }
  }, [])

  const fetchDocuments = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        search: searchQuery,
        sender: senderFilter === 'all' ? '' : senderFilter,
        priority: priorityFilter === 'all' ? '' : priorityFilter,
        sort: sortBy,
        limit: String(ITEMS_PER_PAGE),
        offset: String((currentPage - 1) * ITEMS_PER_PAGE),
      })

      const res = await fetch(`${inboxApiPath}?${params}`)

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to fetch documents')
      }

      const data = await res.json()
      setDocuments(data.data || [])
      setTotalCount(data.total || 0)

      if (data.statusCounts) {
        setStatusCounts(data.statusCounts)
        const counts = data.statusCounts as StatusCounts
        const total =
          (counts.pending ?? 0) +
          (counts.approved ?? 0) +
          (counts.disapproved ?? 0) +
          (counts.returned ?? 0) +
          (counts.returned_with_comments ?? 0)
        setUnfilteredTotal(total)
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred'
      setError(errorMsg)
      setDocuments([])
    } finally {
      setLoading(false)
    }
  }, [
    statusFilter,
    searchQuery,
    senderFilter,
    priorityFilter,
    sortBy,
    currentPage,
  ])

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  useEffect(() => {
    if (!user?.role) return

    const inboxChannel = supabase
      .channel('dpda_inbox_realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'forwarded_documents',
        filter: `recipient_role=eq.${user.role}`,
      }, () => {
        fetchDocuments()
        fetchStatusCounts()
      })
      .subscribe()

    const countsChannel = supabase
      .channel('dpda_status_counts_realtime')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'forwarded_documents',
      }, (payload) => {
        const newRow = payload.new as { recipient_role?: string; dpda_status?: string }
        if (
          newRow?.recipient_role === 'DPDA' ||
          newRow?.recipient_role === 'DPDO'
        ) {
          fetchStatusCounts()
          fetchDocuments()
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(inboxChannel)
      supabase.removeChannel(countsChannel)
    }
  }, [user?.role, fetchDocuments, fetchStatusCounts])

  // Role guard — AFTER all hooks
  if (user && !['DPDA', 'DPDO'].includes(user.role)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900">Access Denied</h2>
          <p className="text-slate-600 mt-2">Only DPDA/DPDO can access this module</p>
        </div>
      </div>
    )
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all([fetchDocuments(), fetchStatusCounts()])
    } finally {
      setRefreshing(false)
    }
  }

  const handleFilterChange = (newFilters: Partial<{
    search: string
    status: string
    sender: string
    priority: string
    sort: string
  }>) => {
    if ('search' in newFilters) setSearchQuery(newFilters.search || '')
    if ('status' in newFilters) setStatusFilter(newFilters.status || 'all')
    if ('sender' in newFilters) setSenderFilter(newFilters.sender || 'all')
    if ('priority' in newFilters) setPriorityFilter(newFilters.priority || 'all')
    if ('sort' in newFilters) setSortBy(newFilters.sort || 'date-desc')
    setCurrentPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE))

  const handleViewDocument = (doc: ForwardedDocument) => {
    setSelectedDocument(doc)
    setIsModalOpen(true)
  }

  return (
    <div className="w-full min-h-screen bg-slate-50 py-8">
      <div className="px-6 lg:px-8 w-full max-w-[1600px] mx-auto">
        {/* Header Section */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-8">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg">
                <Inbox className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-bold text-slate-950">Forwarded Documents</h1>
                <p className="text-slate-500 text-sm mt-1 font-medium">
                  Review and manage forwarded documents
                </p>
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-slate-300 disabled:to-slate-400 text-white rounded-xl transition-all font-semibold shadow-md hover:shadow-lg disabled:cursor-not-allowed active:scale-95"
            >
              <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>

          {/* Status Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
            {[
              {
                label: 'Total Documents',
                value: unfilteredTotal,
                badge: 'ALL RECORDS',
                textColor: 'text-slate-700',
                bgColor: 'bg-slate-50',
                icon: TrendingUp,
              },
              {
                label: 'Pending Review',
                value: statusCounts.pending,
                badge: 'ACTION REQUIRED',
                textColor: 'text-amber-700',
                bgColor: 'bg-amber-50',
                icon: Clock,
              },
              {
                label: 'Approved',
                value: statusCounts.approved,
                badge: 'VERIFIED',
                textColor: 'text-green-700',
                bgColor: 'bg-green-50',
                icon: CheckCircle2,
              },
              {
                label: 'Disapproved',
                value: statusCounts.disapproved,
                badge: 'REJECTED',
                textColor: 'text-red-700',
                bgColor: 'bg-red-50',
                icon: XCircle,
              },
              {
                label: 'Returned',
                value: statusCounts.returned,
                badge: 'RE-EVALUATION',
                textColor: 'text-purple-700',
                bgColor: 'bg-purple-50',
                icon: RotateCcw,
              },
            ].map((stat) => {
              const IconComponent = stat.icon
              return (
                <div
                  key={stat.label}
                  className={`${stat.bgColor} border border-slate-200 rounded-2xl p-6 transition-all hover:shadow-lg hover:border-slate-300 hover:scale-105`}
                >
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <IconComponent className={`w-4 h-4 ${stat.textColor}`} />
                      <p className={`text-xs font-bold tracking-widest uppercase ${stat.textColor}`}>{stat.badge}</p>
                    </div>
                  </div>
                  <p className={`text-xs font-bold tracking-wide uppercase ${stat.textColor} mb-2`}>{stat.label}</p>
                  <p className="text-4xl font-bold text-slate-950">{stat.value}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Filters Section */}
        <div className="mb-6">
          <DPDAFilterBar
            onSearch={(q) => handleFilterChange({ search: q })}
            onStatusChange={(s) => handleFilterChange({ status: s })}
            onSenderChange={(s) => handleFilterChange({ sender: s })}
            onPriorityChange={(p) => handleFilterChange({ priority: p })}
            onSortChange={(s) => handleFilterChange({ sort: s })}
            activeStatus={statusFilter}
            activeSender={senderFilter}
            activePriority={priorityFilter}
            activeSort={sortBy}
          />
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Error loading documents</p>
              <p className="text-sm text-red-600 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Main Content */}
        {loading ? (
          <div className="flex justify-center items-center py-16">
            <LoadingSpinner />
          </div>
        ) : documents.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 py-16 shadow-lg">
            <EmptyState
              icon="📄"
              title="No forwarded files"
              description="There are no forwarded files matching your filters."
            />
          </div>
        ) : (
          <>
            {/* Documents Table - Desktop View */}
            <div className="hidden lg:block">
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-lg">
                {/* Table Header */}
                <div className="bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200 px-6 py-5">
                  <div className="grid grid-cols-10 gap-4 text-xs font-bold text-slate-600 uppercase tracking-widest">
                    <div className="col-span-3">File Name</div>
                    <div className="col-span-2">Sender</div>
                    <div className="col-span-2">Received Date</div>
                    <div className="col-span-2">Status</div>
                  </div>
                </div>

                {/* Table Body */}
                <div>
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="border-b border-slate-200 last:border-b-0 px-6 py-4 hover:bg-blue-50 transition-all cursor-pointer group duration-150"
                      onClick={() => handleViewDocument(doc)}
                    >
                      <div className="grid grid-cols-10 gap-4 items-center">
                        {/* Title Column */}
                        <div className="col-span-3 min-w-0">
                          <div className="flex items-start gap-3">
                            <div className="p-2.5 bg-blue-100 rounded-xl flex-shrink-0 group-hover:bg-blue-200 transition-colors duration-150">
                              <FileText className="w-5 h-5 text-blue-700" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-slate-900 truncate group-hover:text-blue-600 transition-colors duration-150 text-sm">
                                {doc.title}
                              </p>
                              <p className="text-xs text-slate-500 mt-1 font-medium">
                                {doc.document_type === 'master_document' && 'Master Document'}
                                {doc.document_type === 'admin_order' && 'Admin Order'}
                                {doc.document_type === 'daily_journal' && 'Daily Journal'}
                                {doc.document_type === 'library' && 'E-Library'}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Sender Column */}
                        <div className="col-span-2">
                          <p className="text-sm font-bold text-slate-700">{doc.sender_role}</p>
                        </div>

                        {/* Date Column */}
                        <div className="col-span-2">
                          <p className="text-sm text-slate-600 font-medium">
                            {new Date(doc.created_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </p>
                        </div>

                        {/* Status Column */}
                        <div className="col-span-2">
                          <div className="inline-flex">
                            {doc.dpda_status === 'pending' && (
                              <span className="inline-flex items-center gap-2 px-3 py-2 bg-amber-50 text-amber-700 rounded-lg text-xs font-bold border border-amber-200 uppercase tracking-wide">
                                <Clock className="w-4 h-4 flex-shrink-0" />
                                PENDING REVIEW
                              </span>
                            )}
                            {doc.dpda_status === 'approved' && (
                              <span className="inline-flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 rounded-lg text-xs font-bold border border-green-200 uppercase tracking-wide">
                                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                                APPROVED
                              </span>
                            )}
                            {doc.dpda_status === 'disapproved' && (
                              <span className="inline-flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 rounded-lg text-xs font-bold border border-red-200 uppercase tracking-wide">
                                <XCircle className="w-4 h-4 flex-shrink-0" />
                                REJECTED
                              </span>
                            )}
                            {doc.dpda_status === 'returned_with_comments' && (
                              <span className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold border border-blue-200 uppercase tracking-wide">
                                <MessageCircle className="w-4 h-4 flex-shrink-0" />
                                WITH COMMENTS
                              </span>
                            )}
                            {doc.dpda_status === 'returned' && (
                              <span className="inline-flex items-center gap-2 px-3 py-2 bg-purple-50 text-purple-700 rounded-lg text-xs font-bold border border-purple-200 uppercase tracking-wide">
                                <RotateCcw className="w-4 h-4 flex-shrink-0" />
                                RETURNED
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Documents Grid - Mobile/Tablet View */}
            <div className="lg:hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {documents.map((doc) => (
                  <ForwardedFileCard
                    key={doc.id}
                    id={doc.id}
                    title={doc.title}
                    senderRole={doc.sender_role}
                    documentType={doc.document_type}
                    priority={doc.priority || 'medium'}
                    status={(doc.dpda_status || 'pending') as any}
                    dateForwarded={doc.created_at}
                    attachmentCount={doc.forwarded_attachments?.length || 0}
                    onView={() => handleViewDocument(doc)}
                  />
                ))}
              </div>
            </div>

            {/* ── FIX 8: PAGINATION ──────────────────────────────────────────────────
                Previously used `totalPages > 1` which hid the bar when all results
                fit on one page. Now always shown when there are documents, so users
                can always see "Showing X to Y of Z" and know where they are.
            ──────────────────────────────────────────────────────────────────────── */}
            <div className="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-6 border-t border-slate-200">
              <p className="text-sm text-slate-600 font-medium">
                Showing{' '}
                <span className="font-semibold text-slate-900">
                  {totalCount === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1}
                </span>{' '}
                to{' '}
                <span className="font-semibold text-slate-900">
                  {Math.min(currentPage * ITEMS_PER_PAGE, totalCount)}
                </span>{' '}
                of{' '}
                <span className="font-semibold text-slate-900">{totalCount}</span> documents
              </p>

              <div className="flex items-center gap-2 justify-start sm:justify-end">
                {/* Previous */}
                <button
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={currentPage === 1}
                  className="inline-flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="hidden sm:inline">Previous</span>
                </button>

                {/* Page Numbers */}
                <div className="hidden sm:flex gap-1">
                  {(() => {
                    // Build a list of page numbers to display (with ellipsis gaps)
                    const pages: (number | null)[] = []
                    if (totalPages <= 7) {
                      // Show all pages
                      for (let i = 1; i <= totalPages; i++) pages.push(i)
                    } else {
                      // Always show first, last, and a window around currentPage
                      pages.push(1)
                      if (currentPage > 3) pages.push(null) // left ellipsis
                      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
                        pages.push(i)
                      }
                      if (currentPage < totalPages - 2) pages.push(null) // right ellipsis
                      pages.push(totalPages)
                    }

                    return pages.map((page, idx) => {
                      if (page === null) {
                        return (
                          <span key={`ellipsis-${idx}`} className="px-2 py-2 text-slate-500 select-none">
                            …
                          </span>
                        )
                      }
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
                            page === currentPage
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {page}
                        </button>
                      )
                    })
                  })()}
                </div>

                {/* Mobile: current / total */}
                <span className="sm:hidden text-sm font-medium text-slate-600 px-2">
                  {currentPage} / {totalPages}
                </span>

                {/* Next */}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="inline-flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}

        {/* Modal */}
        <FileDetailsModal
          document={selectedDocument}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onRefresh={() => {
            fetchDocuments()
            fetchStatusCounts()
          }}
        />
      </div>
    </div>
  )
}