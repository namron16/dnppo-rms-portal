'use client'
// app/admin/forwarded/page.tsx
// Forwarded Documents inbox — horizontal list layout matching the design spec.
//
// FIXES APPLIED:
//  1. handleSave now reads the `error` and `code` fields from the API response
//     and shows a meaningful message to the user (e.g. "no Drive account",
//     "Drive upload failed") instead of a generic alert.
//  2. The Save button is disabled (with a tooltip) while a save is in progress
//     so users cannot double-submit.
//  3. DPDA comments are now displayed when a returned document is expanded,
//     so P2 can read the feedback that was left before the file was sent back.
//  4. FIX PAGINATION: Pagination is now always shown when there are documents,
//     even when they all fit on one page. Previously `documents.length > pageSize`
//     hid the bar entirely when the list was short — now users always see the
//     "Showing X to Y of Z" count and can navigate freely.

import React, { useEffect, useState, useCallback } from 'react'
import { Pagination } from '@/components/ui/Pagination'
import { usePagination } from '@/hooks'
import { buildAttachmentTree } from '@/lib/forwarding'
import {
  FileText, FolderOpen, BookOpen, ClipboardList,
  User, Calendar, ChevronDown, ChevronUp,
  ExternalLink, Save, X, CheckCircle, Plus, RefreshCw,
  AlertCircle, MessageCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ForwardedDocument = {
  id:                    string
  sender_role:           string
  document_type:         string
  title:                 string
  notes:                 string | null
  gdrive_url:            string
  gdrive_file_id:        string
  file_size_bytes?:      number
  mime_type?:            string
  status:                'pending' | 'saved' | 'dismissed'
  received_at:           string
  saved_at:              string | null
  // FIX 3: dpda_comments may arrive as a parsed array or a JSON string
  dpda_comments?:        any
  dpda_status?:          string
  forwarded_attachments: any[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseComments(raw: any): Array<{ text: string; author: string; timestamp: string; action: string; reason?: string }> {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return []
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  master_document: 'MASTER DOCUMENT',
  admin_order:     'ADMIN ORDER',
  daily_journal:   'DAILY JOURNAL',
  library:         'E-LIBRARY',
}

const DOC_TYPE_BADGE: Record<string, string> = {
  master_document: 'bg-sky-50 text-sky-700',
  admin_order:     'bg-slate-100 text-slate-600',
  daily_journal:   'bg-emerald-50 text-emerald-700',
  library:         'bg-amber-50 text-amber-700',
}

const DOC_TYPE_ICON: Record<string, { bg: string; color: string }> = {
  master_document: { bg: 'bg-blue-100',   color: 'text-blue-600'  },
  admin_order:     { bg: 'bg-slate-100',  color: 'text-slate-500' },
  daily_journal:   { bg: 'bg-red-100',    color: 'text-red-500'   },
  library:         { bg: 'bg-amber-100',  color: 'text-amber-500' },
}

function DocIcon({ type }: { type: string }) {
  const cfg = DOC_TYPE_ICON[type] ?? { bg: 'bg-slate-100', color: 'text-slate-400' }
  const Icon =
    type === 'admin_order'   ? FolderOpen :
    type === 'daily_journal' ? BookOpen   :
    type === 'library'       ? BookOpen   :
    FileText

  return (
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
      <Icon className={`w-4.5 h-4.5 ${cfg.color}`} />
    </div>
  )
}

function getExt(mime?: string): string {
  if (!mime) return 'FILE'
  if (mime.includes('pdf'))   return 'PDF'
  if (mime.includes('word'))  return 'DOCX'
  if (mime.includes('sheet')) return 'XLSX'
  if (mime.includes('image')) return 'IMG'
  return 'FILE'
}

function fmtSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

// ─────────────────────────────────────────────────────────────────────────────
// View button
// ─────────────────────────────────────────────────────────────────────────────

function ViewButton({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="
        inline-flex items-center gap-1.5 px-3.5 py-1.5
        text-xs font-medium text-slate-700
        border border-slate-300 rounded-md
        hover:bg-slate-50 transition-colors
      "
    >
      <ExternalLink className="w-3 h-3" />
      View
    </a>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Error banner
// ─────────────────────────────────────────────────────────────────────────────

function SaveErrorBanner({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  return (
    <div className="
      flex items-start gap-2 px-4 py-2.5 bg-red-50 border-t border-red-200
      text-xs text-red-700
    ">
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span className="flex-1">{message}</span>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-red-400 hover:text-red-600"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DPDA Comments section
// ─────────────────────────────────────────────────────────────────────────────

function DpdaComments({ raw }: { raw: any }) {
  const comments = parseComments(raw)
  if (comments.length === 0) return null

  return (
    <div className="border-t bg-blue-50 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        <MessageCircle className="w-3.5 h-3.5 text-blue-600" />
        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
          DPDA Comments
        </p>
      </div>
      <div className="space-y-2">
        {comments.map((c, idx) => (
          <div key={idx} className="bg-white border border-blue-100 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-blue-700">{c.author}</span>
              <span className="text-xs text-slate-400">
                {new Date(c.timestamp).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                })}
              </span>
            </div>
            <p className="text-xs text-slate-700">{c.text}</p>
            {c.reason && (
              <div className="mt-1.5 flex items-start gap-1.5 px-2 py-1.5 bg-red-50 border border-red-100 rounded-md">
                <span className="text-[10px] font-bold text-red-600 uppercase tracking-wide shrink-0">
                  Reason:
                </span>
                <span className="text-xs text-red-700">{c.reason}</span>
              </div>
            )}
            {c.action && c.action !== 'comment' && (
              <span className={`inline-block mt-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${
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
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Row component
// ─────────────────────────────────────────────────────────────────────────────

function DocRow({
  doc,
  activeTab,
  saving,
  dismissing,
  expanded,
  saveError,
  onSave,
  onDismiss,
  onToggleExpand,
  onClearError,
}: {
  doc:            ForwardedDocument
  activeTab:      'pending' | 'saved' | 'dismissed'
  saving:         string | null
  dismissing:     string | null
  expanded:       string | null
  saveError:      { id: string; message: string } | null
  onSave:         (d: ForwardedDocument) => void
  onDismiss:      (d: ForwardedDocument) => void
  onToggleExpand: (id: string) => void
  onClearError:   (id: string) => void
}) {
  const isExpanded   = expanded === doc.id
  const hasError     = saveError?.id === doc.id
  const tree         = buildAttachmentTree(doc.forwarded_attachments ?? [])
  const ext          = getExt(doc.mime_type)
  const size         = fmtSize(doc.file_size_bytes)
  const isSaving     = saving === doc.id
  const isDismissing = dismissing === doc.id

  const comments     = parseComments(doc.dpda_comments)
  const hasComments  = comments.length > 0

  const hasExpandable = (doc.forwarded_attachments?.length ?? 0) > 0 || hasComments

  const date = new Date(doc.received_at).toLocaleDateString('en-PH', {
    month: 'short', day: '2-digit', year: 'numeric',
  })

  return (
    <div className={`
      bg-white border rounded-lg shadow-sm overflow-hidden
      ${hasError ? 'border-red-300' : 'border-slate-200'}
    `}>
      {/* ── Main Row ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3">

        {/* Icon */}
        <DocIcon type={doc.document_type} />

        {/* Title + meta */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 truncate leading-snug">
            {doc.title}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xs text-slate-400 uppercase tracking-wide">
              {ext}{size ? ` • ${size}` : ''}
            </p>
            {hasComments && doc.dpda_status === 'returned_with_comments' && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200">
                <MessageCircle className="w-2.5 h-2.5" />
                Comments
              </span>
            )}
          </div>
        </div>

        {/* Sender */}
        <div className="hidden sm:flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap flex-shrink-0">
          <User className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{doc.sender_role}</span>
        </div>

        {/* Date */}
        <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-500 flex-shrink-0 whitespace-nowrap">
          <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{date}</span>
        </div>

        {/* Doc type badge */}
        <span className={`
          hidden lg:inline-block text-[10px] font-semibold tracking-widest
          uppercase px-2.5 py-1 rounded-md whitespace-nowrap flex-shrink-0
          ${DOC_TYPE_BADGE[doc.document_type] ?? 'bg-slate-100 text-slate-500'}
        `}>
          {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">

          {hasExpandable && (
            <button
              onClick={() => onToggleExpand(doc.id)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition"
              title="Show details"
            >
              {isExpanded
                ? <ChevronUp   className="w-4 h-4" />
                : <ChevronDown className="w-4 h-4" />}
            </button>
          )}

          <ViewButton url={doc.gdrive_url} />

          {activeTab === 'pending' && (
            <button
              onClick={() => onSave(doc)}
              disabled={isSaving}
              title={
                isSaving
                  ? 'Saving — copying file to your Drive…'
                  : 'Save to your library and copy file to your Google Drive'
              }
              className="
                inline-flex items-center gap-1 px-3.5 py-1.5
                text-xs font-semibold text-white bg-blue-600
                rounded-md hover:bg-blue-700 transition-colors
                disabled:opacity-60 disabled:cursor-not-allowed
              "
            >
              <Save className="w-3 h-3" />
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          )}

          {activeTab === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <CheckCircle className="w-3.5 h-3.5" />
              Saved
            </span>
          )}

          {activeTab === 'pending' && (
            <button
              onClick={() => onDismiss(doc)}
              disabled={isDismissing}
              className="p-1 text-slate-300 hover:text-slate-500 transition disabled:opacity-50"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Notes ───────────────────────────────────────────── */}
      {doc.notes && (
        <div className="px-4 pb-2 -mt-0.5">
          <p className="text-xs text-slate-500 italic">"{doc.notes}"</p>
        </div>
      )}

      {/* ── Save error banner ────────────────────────────────── */}
      {hasError && saveError && (
        <SaveErrorBanner
          message={saveError.message}
          onDismiss={() => onClearError(doc.id)}
        />
      )}

      {/* ── Expanded accordion ───────────────────────────────── */}
      {isExpanded && (
        <>
          {hasComments && <DpdaComments raw={doc.dpda_comments} />}

          {tree.length > 0 && (
            <div className="border-t bg-slate-50 px-4 py-2.5">
              <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
                Attachments
              </p>
              <AttachmentTree nodes={tree} depth={0} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Attachment tree
// ─────────────────────────────────────────────────────────────────────────────

function AttachmentTree({ nodes, depth }: { nodes: any[]; depth: number }) {
  return (
    <div className={depth > 0 ? 'ml-3 border-l border-slate-200 pl-2.5' : ''}>
      {nodes.map((node: any) => (
        <div key={node.id} className="py-1">
          <div className="flex items-center gap-2">
            <FileText className="w-3 h-3 text-slate-400 flex-shrink-0" />
            <span className="text-xs text-slate-600 truncate flex-1">{node.title}</span>
            <a
              href={node.gdrive_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-blue-600 hover:underline flex-shrink-0"
            >
              <ExternalLink className="w-3 h-3" />
              View
            </a>
          </div>
          {node.children?.length > 0 && (
            <AttachmentTree nodes={node.children} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function ForwardedInboxPage() {
  const [documents, setDocuments]   = useState<ForwardedDocument[]>([])
  const [loading, setLoading]       = useState(true)
  const [activeTab, setActiveTab]   = useState<'pending' | 'saved' | 'dismissed'>('pending')
  const [saving, setSaving]         = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [expanded, setExpanded]     = useState<string | null>(null)
  const [userRole, setUserRole]     = useState<string | null>(null)

  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null)

  const fetchInbox = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/forward/inbox?status=${activeTab}`)
      const json = await res.json()
      setDocuments(json.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => { fetchInbox() }, [fetchInbox])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        supabase.from('profiles').select('role').eq('id', data.user.id).single()
          .then(({ data: p }) => { if (p) setUserRole(p.role) })
      }
    })
  }, [])

  useEffect(() => {
    if (!userRole) return
    const channel = supabase
      .channel('forwarded_inbox_realtime')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'forwarded_documents',
        filter: `recipient_role=eq.${userRole}`,
      }, () => fetchInbox())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userRole, fetchInbox])

  const handleSave = async (doc: ForwardedDocument) => {
    setSaving(doc.id)
    setSaveError(null)

    try {
      const res  = await fetch(`/api/forward/${doc.id}/save`, { method: 'POST' })
      const json = await res.json()

      if (json.success) {
        fetchInbox()

        if (json.attachmentErrors?.length) {
          setSaveError({
            id:      doc.id,
            message: `File saved, but ${json.attachmentErrors.length} attachment(s) could not be copied to your Drive: ${json.attachmentErrors.join('; ')}`,
          })
        }
      } else {
        const code   = json.code as string | undefined
        const rawMsg = json.error as string | undefined

        let userMessage: string

        if (code === 'NO_DRIVE_ACCOUNT') {
          userMessage =
            'Save failed: your account has no connected Google Drive. ' +
            'Ask an admin to connect one for you at /admin/gdrive, then try again.'
        } else if (code === 'DRIVE_REUPLOAD_FAILED') {
          userMessage =
            'Save failed: could not copy the file to your Google Drive. ' +
            'Check that your Drive account is connected and has available storage (/admin/gdrive).'
        } else if (code === 'MISSING_DRIVE_METADATA') {
          userMessage =
            'Save failed: this forwarded file is missing Drive metadata. ' +
            'Ask the sender to forward it again.'
        } else {
          userMessage = rawMsg ?? 'An unexpected error occurred. Please try again.'
        }

        setSaveError({ id: doc.id, message: userMessage })
      }
    } catch (err: any) {
      setSaveError({
        id:      doc.id,
        message: `Network error: ${err?.message ?? 'Could not reach the server. Please try again.'}`,
      })
    } finally {
      setSaving(null)
    }
  }

  const handleDismiss = async (doc: ForwardedDocument) => {
    setDismissing(doc.id)
    try {
      await fetch(`/api/forward/${doc.id}/dismiss`, { method: 'PATCH' })
      fetchInbox()
    } finally {
      setDismissing(null)
    }
  }

  const toggleExpand = (id: string) =>
    setExpanded(prev => (prev === id ? null : id))

  const clearSaveError = (id: string) => {
    setSaveError(prev => (prev?.id === id ? null : prev))
  }

  const {
    currentPage, pageSize, totalPages,
    paginatedItems, setCurrentPage, setPageSize,
  } = usePagination({
    items: documents,
    defaultPageSize: 15,
    resetDeps: [activeTab],
  })

  // How many items are on the current page
  const startItem = documents.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const endItem   = Math.min(currentPage * pageSize, documents.length)

  return (
    <div className="space-y-4 px-6 py-6">

      {/* Header */}
      <h1 className="text-2xl font-bold text-slate-900">Forwarded Files</h1>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-slate-200">
        {(['pending', 'saved', 'dismissed'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setSaveError(null) }}
            className={`
              px-4 py-2 text-sm font-medium capitalize transition-colors
              ${activeTab === tab
                ? 'border-b-2 border-blue-600 text-blue-600 -mb-px'
                : 'text-slate-500 hover:text-slate-700'}
            `}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Body */}
      {loading ? (
        <div className="text-center py-20 text-slate-400 text-sm">Loading…</div>
      ) : (
        <div className="space-y-2">

          {/* Document rows */}
          {paginatedItems.map(doc => (
            <DocRow
              key={doc.id}
              doc={doc}
              activeTab={activeTab}
              saving={saving}
              dismissing={dismissing}
              expanded={expanded}
              saveError={saveError}
              onSave={handleSave}
              onDismiss={handleDismiss}
              onToggleExpand={toggleExpand}
              onClearError={clearSaveError}
            />
          ))}

          {/* Empty state */}
          {documents.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">
              No {activeTab} documents.
            </div>
          )}

          {/* Empty slot row — shown at bottom of pending list */}
          {activeTab === 'pending' && (
            <div className="
              border-2 border-dashed border-slate-200 rounded-lg
              flex items-center justify-center gap-3
              py-4 px-5 text-slate-400
            ">
              <div className="w-8 h-8 rounded-full border-2 border-slate-300 flex items-center justify-center">
                <Plus className="w-4 h-4" />
              </div>
              <p className="text-sm">New files forwarded to you will appear here.</p>
              <button
                onClick={fetchInbox}
                className="text-sm text-blue-600 font-medium hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh Inbox
              </button>
            </div>
          )}

          {/* ── FIX 4: PAGINATION ────────────────────────────────────────────────
              Old condition: documents.length > pageSize
              Problem: hides pagination entirely when all results fit on one page,
              so users had no idea how many items they were looking at.

              New behavior: always show when there are documents, so the
              "Showing X to Y of Z" count is always visible and navigation
              buttons appear (greyed out) even on a single page.
          ─────────────────────────────────────────────────────────────────────── */}
          {!loading && documents.length > 0 && (
            <div className="pt-2">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={documents.length}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
                onPageSizeChange={setPageSize}
                pageSizeOptions={[10, 15, 25, 50]}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}