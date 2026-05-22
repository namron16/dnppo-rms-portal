// app/admin/dpda-inbox/page.tsx
// DPDA Inbox - Main page for reviewing forwarded documents
//
// FIXES APPLIED:
//  1. Moved role guard AFTER all hook declarations (React rules of hooks violation)
//  2. Status count cards now use per-status totals from API (not filtered local page data)
//  3. Removed unused getStatusCount() function (dead code)
//  4. Wired up the attachment download button in desktop table

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
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { DPDAFilterBar } from '@/components/dpda-inbox/DPDAFilterBar'
import { ForwardedFileCard } from '@/components/dpda-inbox/ForwardedFileCard'
import { FileDetailsModal } from '@/components/dpda-inbox/FileDetailsModal'
import type { ForwardedDocument } from '@/components/dpda-inbox/FileDetailsModal'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'

// Use the shared `ForwardedDocument` type exported by `FileDetailsModal` to
// avoid duplicate incompatible definitions across modules.

// FIX: Added statusCounts to track per-status totals from the API
interface StatusCounts {
  pending: number
  approved: number
  disapproved: number
  returned: number
}

const ITEMS_PER_PAGE = 12

export default function DPDAInboxPage() {
  const { user } = useAuth()
  const [documents, setDocuments] = useState<ForwardedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // FIX: Separate state for per-status counts (from API) vs local page data
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({
    pending: 0,
    approved: 0,
    disapproved: 0,
    returned: 0,
  })

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

      const res = await fetch(`/api/dpda-inbox?${params}`)

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to fetch documents')
      }

      const data = await res.json()
      setDocuments(data.data || [])
      setTotalCount(data.total || 0)

      // FIX: Read per-status counts returned by the API instead of filtering local page
      if (data.statusCounts) {
        setStatusCounts(data.statusCounts)
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

  // FIX: Role guard moved here — AFTER all hook declarations — to satisfy React rules of hooks.
  // Previously this guard appeared between hook declarations, which is a rules violation.
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
      await fetchDocuments()
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

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE)

  const handleViewDocument = (doc: ForwardedDocument) => {
    setSelectedDocument(doc)
    setIsModalOpen(true)
  }

  // FIX: Removed unused getStatusCount() function

  return (
    <div className="w-full min-h-screen bg-slate-50 py-8">
      <div className="px-6 lg:px-8 w-full max-w-[1600px] mx-auto">
        {/* Header Section */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="p-3.5 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-md">
                <Inbox className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-slate-900">DPDA Inbox</h1>
                <p className="text-slate-600 text-sm mt-0.5">
                  Document review and approval workflow
                </p>
              </div>
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg transition-colors font-medium shadow-sm hover:shadow-md disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {/* Status Summary Cards */}
          {/* FIX: Values now come from statusCounts (API totals), not filtered local page data */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              {
                label: 'Total Documents',
                value: totalCount,
                color: 'from-slate-500 to-slate-600',
                textColor: 'text-slate-700',
                bgColor: 'bg-slate-50'
              },
              {
                label: 'Pending Review',
                value: statusCounts.pending,
                color: 'from-amber-500 to-amber-600',
                textColor: 'text-amber-700',
                bgColor: 'bg-amber-50'
              },
              {
                label: 'Approved',
                value: statusCounts.approved,
                color: 'from-green-500 to-green-600',
                textColor: 'text-green-700',
                bgColor: 'bg-green-50'
              },
              {
                label: 'Disapproved',
                value: statusCounts.disapproved,
                color: 'from-red-500 to-red-600',
                textColor: 'text-red-700',
                bgColor: 'bg-red-50'
              },
              {
                label: 'Returned',
                value: statusCounts.returned,
                color: 'from-purple-500 to-purple-600',
                textColor: 'text-purple-700',
                bgColor: 'bg-purple-50'
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className={`${stat.bgColor} border border-slate-200 rounded-lg p-5 transition-all hover:shadow-md hover:border-slate-300`}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className={`text-sm font-semibold ${stat.textColor}`}>{stat.label}</p>
                  <div className={`bg-gradient-to-br ${stat.color} p-2 rounded-lg`}>
                    <div className="w-3 h-3 bg-white rounded-full"></div>
                  </div>
                </div>
                <p className="text-3xl font-bold text-slate-900">{stat.value}</p>
              </div>
            ))}
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
          <div className="bg-white rounded-lg border border-slate-200 py-16">
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
              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                {/* Table Header */}
                <div className="bg-slate-50 border-b border-slate-200 px-6 py-4">
                  <div className="grid grid-cols-12 gap-4 text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    <div className="col-span-3">File Title</div>
                    <div className="col-span-2">From</div>
                    <div className="col-span-2">Date</div>
                    <div className="col-span-2">Status</div>
                    <div className="col-span-1">Priority</div>
                    <div className="col-span-2 text-right">Actions</div>
                  </div>
                </div>

                {/* Table Body */}
                <div>
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="border-b border-slate-200 last:border-b-0 px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer group"
                      onClick={() => handleViewDocument(doc)}
                    >
                      <div className="grid grid-cols-12 gap-4 items-center">
                        {/* Title Column */}
                        <div className="col-span-3 min-w-0">
                          <div className="flex items-start gap-3">
                            <div className="p-2 bg-blue-50 rounded-lg flex-shrink-0 group-hover:bg-blue-100 transition-colors">
                              <FileText className="w-4 h-4 text-blue-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 truncate group-hover:text-blue-600 transition-colors">
                                {doc.title}
                              </p>
                              <p className="text-xs text-slate-500 mt-0.5">
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
                          <p className="text-sm font-medium text-slate-700">{doc.sender_role}</p>
                        </div>

                        {/* Date Column */}
                        <div className="col-span-2">
                          <p className="text-sm text-slate-600">
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
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-50 text-amber-700 rounded-md text-xs font-medium border border-amber-200">
                                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full"></div>
                                Pending
                              </span>
                            )}
                            {doc.dpda_status === 'approved' && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-green-50 text-green-700 rounded-md text-xs font-medium border border-green-200">
                                <div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                                Approved
                              </span>
                            )}
                            {doc.dpda_status === 'disapproved' && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-red-50 text-red-700 rounded-md text-xs font-medium border border-red-200">
                                <div className="w-1.5 h-1.5 bg-red-500 rounded-full"></div>
                                Disapproved
                              </span>
                            )}
                            {doc.dpda_status === 'returned_with_comments' && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 text-blue-700 rounded-md text-xs font-medium border border-blue-200">
                                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                                With Comments
                              </span>
                            )}
                            {doc.dpda_status === 'returned' && (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-purple-50 text-purple-700 rounded-md text-xs font-medium border border-purple-200">
                                <div className="w-1.5 h-1.5 bg-purple-500 rounded-full"></div>
                                Returned
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Priority Column */}
                        <div className="col-span-1">
                          {doc.priority && (
                            <span className={`inline-flex px-2 py-1 rounded-md text-xs font-medium ${
                              doc.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                              doc.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                              doc.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                              'bg-green-100 text-green-700'
                            }`}>
                              {doc.priority.charAt(0).toUpperCase() + doc.priority.slice(1)}
                            </span>
                          )}
                        </div>

                        {/* Actions Column */}
                        {/* FIX: Attachment download button now opens the modal where files are listed */}
                        <div className="col-span-2 flex justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleViewDocument(doc)
                            }}
                            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition-colors text-xs font-medium border border-blue-200"
                          >
                            View
                          </button>
                          {doc.forwarded_attachments && doc.forwarded_attachments.length > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                // FIX: Open modal to view/download attachments instead of no-op
                                handleViewDocument(doc)
                              }}
                              className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg transition-colors text-xs font-medium border border-slate-200 flex items-center gap-1"
                              title="View attachments"
                            >
                              <Download className="w-3 h-3" />
                              {doc.forwarded_attachments.length}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Documents Grid - Mobile/Tablet View */}
            <div className="lg:hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-6 border-t border-slate-200">
                <p className="text-sm text-slate-600 font-medium">
                  Showing <span className="font-semibold text-slate-900">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> to{' '}
                  <span className="font-semibold text-slate-900">{Math.min(currentPage * ITEMS_PER_PAGE, totalCount)}</span> of{' '}
                  <span className="font-semibold text-slate-900">{totalCount}</span> documents
                </p>
                <div className="flex items-center gap-2 justify-start sm:justify-end">
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
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      const page = i + 1
                      if (totalPages <= 5) return page
                      if (page === 1 || page === totalPages) return page
                      if (Math.abs(page - currentPage) <= 1) return page
                      return null
                    }).map((page, idx, arr) => {
                      // When `page` is null we want to render an ellipsis, but only
                      // if there's a gap between the previous and next numeric pages.
                      // Use the neighboring entries to compute the gap instead of
                      // attempting to coerce the null `page` value to a number.
                      if (page === null) {
                        const nextPage = arr[idx + 1] as number | null
                        const prevPage = arr[idx - 1] as number | null
                        if (nextPage && prevPage && nextPage - prevPage > 1) {
                          return (
                            <span key={`ellipsis-${idx}`} className="px-2 py-2 text-slate-500">
                              ...
                            </span>
                          )
                        }
                        return null
                      }
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`px-3 py-2 rounded-lg font-medium transition-colors ${
                            page === currentPage
                              ? 'bg-blue-600 text-white'
                              : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {page}
                        </button>
                      )
                    })}
                  </div>

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
            )}
          </>
        )}

        {/* Modal */}
        <FileDetailsModal
          document={selectedDocument}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onRefresh={fetchDocuments}
        />
      </div>
    </div>
  )
}