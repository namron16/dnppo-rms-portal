// components/dpda-inbox/FileDetailsModal.tsx
// Detailed view modal for forwarded file with approval/disapproval options
//
// FIXES APPLIED:
//  1. handleForwardBack now stores the error in component state and
//     displays it in the footer — previously the catch block set setError()
//     but the error banner was only rendered inside the `action` panel,
//     which is hidden when no action is selected. The error was invisible.
//
//  2. handleAddComment: after a successful comment POST, we no longer show
//     a "Comment added" success toast. Instead we immediately flip the local
//     document status to 'returned_with_comments' and clear the action panel
//     so the "Forward back to sender" button appears right away — the DPDA
//     no longer has to close and reopen the modal.
//
//  3. Comments from DPDA are now rendered inside the modal so P2 can read
//     them when they open the returned document from their own inbox.

'use client'

import React, { useState, useEffect } from 'react'
import {
  X,
  FileText,
  MessageSquare,
  CheckCircle,
  XCircle,
  Download,
  Send,
  AlertCircle,
  MessageCircle,
} from 'lucide-react'

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
  dpda_comments?: any        // JSONB array from DB — may arrive as string or parsed array
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

// ── Helper: safely parse dpda_comments regardless of storage format ───────────
// The column is JSONB so Supabase may return it already parsed (array) or as a
// raw JSON string depending on the client version. Handle both.
function parseComments(raw: any): Array<{ text: string; author: string; timestamp: string; action: string }> {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return []
}

export function FileDetailsModal({
  document,
  isOpen,
  onClose,
  onRefresh,
}: FileDetailsModalProps) {
  const [loading, setLoading]                 = useState(false)
  const [action, setAction]                   = useState<ActionType>(null)
  const [comments, setComments]               = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [error, setError]                     = useState('')
  const [success, setSuccess]                 = useState('')

  // FIX 2: local copy of dpda_status so we can update it optimistically
  // after adding a comment without waiting for the parent to re-fetch.
  const [localDpdaStatus, setLocalDpdaStatus] = useState<string | undefined>(undefined)

  // FIX 1: separate state for forward-back errors so they are visible
  // at footer level even when no action panel is open.
  const [forwardBackError, setForwardBackError] = useState('')

  useEffect(() => {
    if (!isOpen) {
      setComments('')
      setRejectionReason('')
      setError('')
      setSuccess('')
      setAction(null)
      setForwardBackError('')
      setLocalDpdaStatus(undefined)
    }
  }, [isOpen])

  // Sync localDpdaStatus whenever the document prop changes
  useEffect(() => {
    setLocalDpdaStatus(document?.dpda_status)
  }, [document?.dpda_status])

  if (!isOpen || !document) return null

  // Use localDpdaStatus for rendering so optimistic updates apply immediately
  const effectiveDpdaStatus = localDpdaStatus ?? document.dpda_status

  // Parsed comments array (FIX 3)
  const parsedComments = parseComments(document.dpda_comments)

  const handleApprove = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/dpda-inbox/${document.id}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ comments }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to approve')
      }

      setSuccess('Document approved successfully!')
      setTimeout(() => { onRefresh(); onClose() }, 1500)
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
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ comments, reason: rejectionReason }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to disapprove')
      }

      setSuccess('Document disapproved successfully!')
      setTimeout(() => { onRefresh(); onClose() }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  // FIX 2: After a successful comment:
  //   • Do NOT show a success toast.
  //   • Immediately flip local status to 'returned_with_comments'.
  //   • Clear the action panel so the footer re-renders with the
  //     "Forward back to sender" button visible right away.
  const handleAddComment = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/dpda-inbox/${document.id}/comment`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ comment: comments }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add comment')
      }

      // Optimistically update local status so the Forward Back button appears
      setLocalDpdaStatus('returned_with_comments')

      // Clear the comment form and close the action panel
      setComments('')
      setAction(null)

      // Trigger background refresh (non-blocking — modal stays open)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleForwardBack = async () => {
    setLoading(true)
    setForwardBackError('')
    setError('')
    try {
      const res = await fetch(`/api/dpda-inbox/${document.id}/forward-back`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to forward back')
      }

      setSuccess('Document forwarded back to sender!')
      setTimeout(() => { onRefresh(); onClose() }, 1500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred'
      setForwardBackError(msg)
    } finally {
      setLoading(false)
    }
  }

  const DOC_TYPE_LABELS: Record<string, string> = {
    master_document: 'Master Document',
    admin_order:     'Admin Order',
    daily_journal:   'Daily Journal',
    library:         'E-Library',
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[95vh] overflow-hidden shadow-2xl flex flex-col">

        {/* Header */}
        <div className="border-b border-slate-200 px-6 py-5 flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-start gap-3 mb-3">
              <div className="p-2.5 bg-blue-100 rounded-lg flex-shrink-0">
                <FileText className="w-5 h-5 text-blue-700" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-slate-900 truncate">{document.title}</h2>
                <p className="text-xs text-slate-500 font-medium mt-1">Document ID: {document.id}</p>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors p-1.5 hover:bg-slate-100 rounded-lg flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Metadata Row */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-4">
          <div className="grid grid-cols-4 gap-6 text-sm">
            <div>
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">Sender</p>
              <p className="font-semibold text-slate-900">{document.sender_role}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">Type</p>
              <p className="font-semibold text-slate-900">
                {DOC_TYPE_LABELS[document.document_type] || document.document_type}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">Date Received</p>
              <p className="font-semibold text-slate-900">
                {new Date(document.created_at).toLocaleDateString('en-US', {
                  month:  'short',
                  day:    'numeric',
                  year:   'numeric',
                  hour:   '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-1">Current Status</p>
              <div>
                {effectiveDpdaStatus === 'pending' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-700 rounded-md text-xs font-bold border border-amber-200">
                    Pending Review
                  </span>
                )}
                {effectiveDpdaStatus === 'approved' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-50 text-green-700 rounded-md text-xs font-bold border border-green-200">
                    Approved
                  </span>
                )}
                {effectiveDpdaStatus === 'disapproved' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-700 rounded-md text-xs font-bold border border-red-200">
                    Rejected
                  </span>
                )}
                {effectiveDpdaStatus === 'returned_with_comments' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-bold border border-blue-200">
                    With Comments
                  </span>
                )}
                {effectiveDpdaStatus === 'returned' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-50 text-purple-700 rounded-md text-xs font-bold border border-purple-200">
                    Returned
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto bg-white">

          {/* Document Viewer Area */}
          <div className="flex items-center justify-center p-6 border-b border-slate-100">
            <div className="bg-slate-100 rounded-lg w-full aspect-video flex items-center justify-center border border-slate-300">
              <div className="text-center">
                <div className="p-4 bg-slate-200 rounded-lg inline-block mb-4">
                  <FileText className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-slate-600 font-medium mb-2">Document Preview</p>
                <a
                  href={document.gdrive_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-semibold text-sm"
                >
                  <Download className="w-4 h-4" />
                  Open Document
                </a>
              </div>
            </div>
          </div>

          {/* FIX 3: DPDA Comments section — visible to both DPDA and P2 ─────── */}
          {parsedComments.length > 0 && (
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2 mb-3">
                <MessageCircle className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
                  DPDA Comments
                </h3>
              </div>
              <div className="space-y-3">
                {parsedComments.map((c, idx) => (
                  <div key={idx} className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-blue-700">{c.author}</span>
                      <span className="text-xs text-slate-400">
                        {new Date(c.timestamp).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700">{c.text}</p>
                    {c.action && c.action !== 'comment' && (
                      <span className={`inline-block mt-1.5 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${
                        c.action === 'approved'    ? 'bg-green-100 text-green-700' :
                        c.action === 'disapproved' ? 'bg-red-100 text-red-700'    :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {c.action}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Action Buttons Footer */}
        <div className="border-t border-slate-200 px-6 py-5 bg-slate-50">

          {/* FIX 1: forward-back error banner — visible regardless of action panel state */}
          {forwardBackError && (
            <div className="mb-4 flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Failed to forward back</p>
                <p className="mt-0.5">{forwardBackError}</p>
              </div>
            </div>
          )}

          {/* Global success banner (approve / disapprove / forward-back) */}
          {success && (
            <div className="mb-4 flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            {effectiveDpdaStatus !== 'approved' &&
             effectiveDpdaStatus !== 'disapproved' &&
             effectiveDpdaStatus !== 'returned' ? (
              <>
                <button
                  onClick={() => setAction('approve')}
                  disabled={loading || action !== null}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                >
                  <CheckCircle className="w-4 h-4" />
                  Approve
                </button>
                <button
                  onClick={() => setAction('disapprove')}
                  disabled={loading || action !== null}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-red-500 text-red-500 rounded-lg transition-colors font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-50"
                >
                  <XCircle className="w-4 h-4" />
                  Reject
                </button>
                <button
                  onClick={() => setAction('comment')}
                  disabled={loading || action !== null}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg transition-colors font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:border-slate-400 hover:bg-slate-50"
                >
                  <MessageSquare className="w-4 h-4" />
                  Comment
                </button>
              </>
            ) : (
              <div className="flex-1 text-center">
                <p className="text-sm font-semibold text-slate-700">
                  This document has been {effectiveDpdaStatus?.replace(/_/g, ' ')}.
                </p>
              </div>
            )}

            {/* FIX 2: "Forward back" button uses effectiveDpdaStatus so it shows
                immediately after a successful comment without needing a modal reopen. */}
            {effectiveDpdaStatus &&
             ['approved', 'disapproved', 'returned_with_comments'].includes(effectiveDpdaStatus) && (
              <button
                onClick={handleForwardBack}
                disabled={loading}
                className="ml-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg transition-colors font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:border-slate-400 hover:bg-slate-50"
              >
                <Send className="w-4 h-4" />
                {loading ? 'Forwarding...' : 'Forward back to sender'}
              </button>
            )}
          </div>

          {/* Action Forms (approve / disapprove / comment) */}
          {action && (
            <div className="mt-5 p-4 bg-white border border-slate-200 rounded-lg space-y-4">
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
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
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
                  rows={4}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm resize-none"
                />
              </div>

              {error && (
                <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    if (action === 'approve')         handleApprove()
                    else if (action === 'disapprove') handleDisapprove()
                    else if (action === 'comment')    handleAddComment()
                  }}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                  {loading ? 'Processing...' : 'Confirm'}
                </button>
                <button
                  onClick={() => {
                    setAction(null)
                    setComments('')
                    setRejectionReason('')
                    setError('')
                    setSuccess('')
                  }}
                  disabled={loading}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors font-bold text-sm disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}