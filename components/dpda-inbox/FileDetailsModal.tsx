// components/dpda-inbox/FileDetailsModal.tsx
// Detailed view modal for forwarded file with approval/disapproval options

'use client'

import React, { useState, useEffect } from 'react'
import {
  X,
  FileText,
  Calendar,
  User,
  MessageSquare,
  CheckCircle,
  XCircle,
  Download,
  Paperclip,
  Clock,
  Send,
  AlertCircle,
} from 'lucide-react'
import { DPDAStatusBadge } from '@/components/ui/DPDAStatusBadge'
import { PriorityBadge } from '@/components/ui/PriorityBadge'

export interface ForwardedDocument {
  id: string
  sender_role: string
  document_type: string
  title: string
  notes?: string
  gdrive_file_id: string
  gdrive_url: string
  file_size_bytes?: number
  file_name?: string
  mime_type?: string
  status: 'pending' | 'approved' | 'disapproved' | 'returned_with_comments' | 'returned'
  priority?: string
  created_at: string
  dpda_comments?: string
  dpda_status?: string
  dpda_reviewed_at?: string
  forwarded_attachments?: Array<{
    id: string
    title: string
    file_name?: string
    file_size_bytes?: number
    mime_type?: string
    gdrive_file_id: string
    gdrive_url: string
  }>
}

export interface FileDetailsModalProps {
  document: ForwardedDocument | null
  isOpen: boolean
  onClose: () => void
  onRefresh: () => void
}

type ActionType = 'approve' | 'disapprove' | 'comment' | null

export function FileDetailsModal({
  document,
  isOpen,
  onClose,
  onRefresh,
}: FileDetailsModalProps) {
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState<ActionType>(null)
  const [comments, setComments] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!isOpen) {
      setComments('')
      setRejectionReason('')
      setError('')
      setSuccess('')
      setAction(null)
    }
  }, [isOpen])

  if (!isOpen || !document) return null

  const handleApprove = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/dpda-inbox/${document.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to approve')
      }

      setSuccess('Document approved successfully!')
      setTimeout(() => {
        onRefresh()
        onClose()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleDisapprove = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/dpda-inbox/${document.id}/disapprove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comments,
          reason: rejectionReason,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to disapprove')
      }

      setSuccess('Document disapproved successfully!')
      setTimeout(() => {
        onRefresh()
        onClose()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleAddComment = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/dpda-inbox/${document.id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: comments }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add comment')
      }

      setSuccess('Comment added successfully!')
      setComments('')
      setTimeout(() => onRefresh(), 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleForwardBack = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/dpda-inbox/${document.id}/forward-back`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to forward back')
      }

      setSuccess('Document forwarded back to sender!')
      setTimeout(() => {
        onRefresh()
        onClose()
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString)
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateString
    }
  }

  const DOC_TYPE_LABELS: Record<string, string> = {
    master_document: 'Master Document',
    admin_order: 'Admin Order',
    daily_journal: 'Daily Journal',
    library: 'E-Library',
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-auto">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl my-8">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-slate-900 to-slate-800 border-b border-slate-200 px-8 py-6 flex items-start justify-between">
          <div className="flex-1 pr-4">
            <h2 className="text-2xl font-bold text-white mb-3">{document.title}</h2>
            <div className="flex items-center gap-3 flex-wrap">
              {document.dpda_status && (
                <DPDAStatusBadge
                  status={document.dpda_status as any}
                  size="sm"
                />
              )}
              {document.priority && (
                <PriorityBadge priority={document.priority as any} size="sm" />
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-300 hover:text-white transition-colors mt-1 p-1 hover:bg-slate-700 rounded-lg"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-8 space-y-8">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">From</p>
              <p className="text-lg font-semibold text-slate-900">{document.sender_role}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Document Type</p>
              <p className="text-lg font-semibold text-slate-900">
                {DOC_TYPE_LABELS[document.document_type] || document.document_type}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Received</p>
              <p className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" />
                {formatDate(document.created_at)}
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">Current Status</p>
              <p className="text-lg font-semibold text-slate-900">
                {(document.dpda_status || 'Pending').charAt(0).toUpperCase() + (document.dpda_status || 'Pending').slice(1)}
              </p>
            </div>
          </div>

          {/* Notes Section */}
          {document.notes && (
            <div className="p-5 bg-blue-50 border-l-4 border-blue-500 rounded-lg">
              <p className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Sender's Notes
              </p>
              <p className="text-slate-900 text-sm leading-relaxed">{document.notes}</p>
            </div>
          )}

          {/* Main Document Section */}
          <div>
            <p className="text-lg font-bold text-slate-900 mb-4">Document Files</p>
            <div className="space-y-4">
              {/* Main Document */}
              <div className="p-5 bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-300 rounded-lg hover:shadow-md transition-all">
                <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide mb-3">Primary Document</p>
                <a
                  href={document.gdrive_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-4 group"
                >
                  <div className="p-3 bg-white rounded-lg group-hover:shadow-md transition-shadow">
                    <FileText className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                      {document.file_name || 'View Document'}
                    </p>
                    {document.file_size_bytes && (
                      <p className="text-xs text-slate-600 mt-1">
                        Size: {(document.file_size_bytes / 1024 / 1024).toFixed(2)} MB
                      </p>
                    )}
                  </div>
                  <Download className="w-5 h-5 text-blue-600 group-hover:text-blue-700 flex-shrink-0 transition-colors" />
                </a>
              </div>

              {/* Attachments */}
              {document.forwarded_attachments && document.forwarded_attachments.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <Paperclip className="w-4 h-4" />
                    Attached Documents ({document.forwarded_attachments.length})
                  </p>
                  <div className="space-y-2">
                    {document.forwarded_attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.gdrive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 border border-slate-300 rounded-lg hover:bg-slate-50 hover:border-slate-400 transition-all group"
                      >
                        <FileText className="w-4 h-4 text-slate-600 group-hover:text-blue-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 truncate text-sm group-hover:text-blue-600 transition-colors">
                            {att.title}
                          </p>
                          {att.file_size_bytes && (
                            <p className="text-xs text-slate-500">
                              {(att.file_size_bytes / 1024 / 1024).toFixed(2)} MB
                            </p>
                          )}
                        </div>
                        <Download className="w-4 h-4 text-slate-400 group-hover:text-blue-600 flex-shrink-0 transition-colors" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Section */}
          {document.dpda_status !== 'approved' &&
          document.dpda_status !== 'disapproved' &&
          document.dpda_status !== 'returned' ? (
            <div className="border border-slate-300 rounded-lg p-6 bg-slate-50">
              <p className="text-lg font-bold text-slate-900 mb-5">Review & Approve</p>

              {!action ? (
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => setAction('approve')}
                    className="flex items-center justify-center gap-2 px-5 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-semibold shadow-sm hover:shadow-md"
                  >
                    <CheckCircle className="w-5 h-5" />
                    <span>Approve</span>
                  </button>
                  <button
                    onClick={() => setAction('disapprove')}
                    className="flex items-center justify-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-semibold shadow-sm hover:shadow-md"
                  >
                    <XCircle className="w-5 h-5" />
                    <span>Reject</span>
                  </button>
                  <button
                    onClick={() => setAction('comment')}
                    className="flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-semibold shadow-sm hover:shadow-md"
                  >
                    <MessageSquare className="w-5 h-5" />
                    <span>Comment</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {action === 'disapprove' && (
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        Reason for Rejection
                      </label>
                      <input
                        type="text"
                        placeholder="Brief reason for rejection..."
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                      {action === 'comment' ? 'Add Comment' : 'Additional Notes'}
                    </label>
                    <textarea
                      placeholder={
                        action === 'approve'
                          ? 'Add approval notes (optional)...'
                          : action === 'disapprove'
                            ? 'Add detailed feedback for rejection...'
                            : 'Add your comment...'
                      }
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      rows={5}
                      className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm resize-none font-normal"
                    />
                  </div>

                  {error && (
                    <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">{error}</span>
                    </div>
                  )}

                  {success && (
                    <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
                      <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <span className="text-sm font-medium">{success}</span>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => {
                        if (action === 'approve') handleApprove()
                        else if (action === 'disapprove') handleDisapprove()
                        else if (action === 'comment') handleAddComment()
                      }}
                      disabled={loading}
                      className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                    >
                      <Send className="w-4 h-4" />
                      {loading ? 'Processing...' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setAction(null)}
                      disabled={loading}
                      className="px-5 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-semibold disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-4 p-6 bg-green-50 border-l-4 border-green-500 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-green-900 text-lg">Document Processed</p>
                <p className="text-sm text-green-800 mt-1">
                  This document has been {document.dpda_status?.replace(/_/g, ' ')}.
                </p>
              </div>
            </div>
          )}

          {/* Forward Back Button */}
          {document.dpda_status && ['approved', 'disapproved', 'returned_with_comments'].includes(document.dpda_status) && (
            <button
              onClick={handleForwardBack}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md text-lg"
            >
              <Send className="w-5 h-5" />
              {loading ? 'Processing...' : 'Forward Back to Sender'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
