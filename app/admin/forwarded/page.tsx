'use client'
// app/admin/forwarded/page.tsx
// Forwarded Documents inbox — horizontal list layout matching the design spec.

import React, { useEffect, useState, useCallback } from 'react'
import { Pagination }  from '@/components/ui/Pagination'
import { usePagination } from '@/hooks'
import { buildAttachmentTree } from '@/lib/forwarding'
import {
  FileText, FolderOpen, BookOpen, ClipboardList,
  User, Calendar, ChevronDown, ChevronUp,
  ExternalLink, Save, X, CheckCircle, Plus, RefreshCw,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
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
  forwarded_attachments: any[]
}

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const DOC_TYPE_LABELS: Record<string, string> = {
  master_document: 'MASTER DOCUMENT',
  admin_order:     'ADMIN ORDER',
  daily_journal:   'DAILY JOURNAL',
  library:         'E-LIBRARY',
}

// Badge colours — subtle pill, no border
const DOC_TYPE_BADGE: Record<string, string> = {
  master_document: 'bg-sky-50 text-sky-700',
  admin_order:     'bg-slate-100 text-slate-600',
  daily_journal:   'bg-emerald-50 text-emerald-700',
  library:         'bg-amber-50 text-amber-700',
}

// Icon box colours
const DOC_TYPE_ICON: Record<string, { bg: string; color: string }> = {
  master_document: { bg: 'bg-blue-100',   color: 'text-blue-600'  },
  admin_order:     { bg: 'bg-slate-100',  color: 'text-slate-500' },
  daily_journal:   { bg: 'bg-red-100',    color: 'text-red-500'   },
  library:         { bg: 'bg-amber-100',  color: 'text-amber-500' },
}

function DocIcon({ type }: { type: string }) {
  const cfg = DOC_TYPE_ICON[type] ?? { bg: 'bg-slate-100', color: 'text-slate-400' }
  const Icon =
    type === 'admin_order'     ? FolderOpen  :
    type === 'daily_journal'   ? BookOpen    :
    type === 'library'         ? BookOpen    :
    FileText

  return (
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
      <Icon className={`w-4.5 h-4.5 ${cfg.color}`} />
    </div>
  )
}

/**
 * Derive a human-readable file extension from mime_type or fall back to "FILE".
 */
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

// ─────────────────────────────────────────────────────────────
// VIEW BUTTON — opens the GDrive file in a new tab
// ─────────────────────────────────────────────────────────────
//
// WHY THIS APPROACH?
//   The forwarded document already has a `gdrive_url` (webViewLink) that
//   Google Drive serves — clicking "View" simply opens that link in a new tab
//   at a native Drive preview. No extra backend work or embed needed.
//
//   If you'd prefer an in-app preview panel, you can swap the <a> tag for a
//   modal containing an <iframe src={`https://drive.google.com/file/d/${gdrive_file_id}/preview`} />
//   — Google allows embedding Drive files this way without extra auth as long
//   as the file has "Anyone with link can view" permission (which the upload
//   gateway already sets via permissions.create { role: 'reader', type: 'anyone' }).
//
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

// ─────────────────────────────────────────────────────────────
// Row component
// ─────────────────────────────────────────────────────────────
function DocRow({
  doc,
  activeTab,
  saving,
  dismissing,
  expanded,
  onSave,
  onDismiss,
  onToggleExpand,
}: {
  doc:            ForwardedDocument
  activeTab:      'pending' | 'saved' | 'dismissed'
  saving:         string | null
  dismissing:     string | null
  expanded:       string | null
  onSave:         (d: ForwardedDocument) => void
  onDismiss:      (d: ForwardedDocument) => void
  onToggleExpand: (id: string) => void
}) {
  const isExpanded = expanded === doc.id
  const tree = buildAttachmentTree(doc.forwarded_attachments ?? [])
  const ext  = getExt(doc.mime_type)
  const size = fmtSize(doc.file_size_bytes)
  const date = new Date(doc.received_at).toLocaleDateString('en-PH', {
    month: 'short', day: '2-digit', year: 'numeric',
  })

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      {/* ── Main Row ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3">

        {/* Icon */}
        <DocIcon type={doc.document_type} />

        {/* Title + meta */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 truncate leading-snug">
            {doc.title}
          </p>
          <p className="text-xs text-slate-400 mt-0.5 uppercase tracking-wide">
            {ext}{size ? ` • ${size}` : ''}
          </p>
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

          {/* Attachments toggle */}
          {doc.forwarded_attachments?.length > 0 && (
            <button
              onClick={() => onToggleExpand(doc.id)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition"
              title="Show attachments"
            >
              {isExpanded
                ? <ChevronUp   className="w-4 h-4" />
                : <ChevronDown className="w-4 h-4" />}
            </button>
          )}

          {/* View — always visible */}
          <ViewButton url={doc.gdrive_url} />

          {/* Save (pending only) */}
          {activeTab === 'pending' && (
            <button
              onClick={() => onSave(doc)}
              disabled={saving === doc.id}
              className="
                inline-flex items-center gap-1 px-3.5 py-1.5
                text-xs font-semibold text-white bg-blue-600
                rounded-md hover:bg-blue-700 transition-colors
                disabled:opacity-60
              "
            >
              <Save className="w-3 h-3" />
              {saving === doc.id ? 'Saving…' : 'Save'}
            </button>
          )}

          {/* Saved badge (saved tab) */}
          {activeTab === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <CheckCircle className="w-3.5 h-3.5" />
              Saved
            </span>
          )}

          {/* Dismiss (pending only) */}
          {activeTab === 'pending' && (
            <button
              onClick={() => onDismiss(doc)}
              disabled={dismissing === doc.id}
              className="p-1 text-slate-300 hover:text-slate-500 transition"
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

      {/* ── Attachments accordion ────────────────────────────── */}
      {isExpanded && tree.length > 0 && (
        <div className="border-t bg-slate-50 px-4 py-2.5">
          <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
            Attachments
          </p>
          <AttachmentTree nodes={tree} depth={0} />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Attachment tree
// ─────────────────────────────────────────────────────────────
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
              className="
                flex items-center gap-1 text-xs text-blue-600
                hover:underline flex-shrink-0
              "
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

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function ForwardedInboxPage() {
  const [documents, setDocuments]   = useState<ForwardedDocument[]>([])
  const [loading, setLoading]       = useState(true)
  const [activeTab, setActiveTab]   = useState<'pending' | 'saved' | 'dismissed'>('pending')
  const [saving, setSaving]         = useState<string | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [expanded, setExpanded]     = useState<string | null>(null)

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

  const handleSave = async (doc: ForwardedDocument) => {
    setSaving(doc.id)
    try {
      const res  = await fetch(`/api/forward/${doc.id}/save`, { method: 'POST' })
      const json = await res.json()
      if (json.success) fetchInbox()
      else alert(`Save failed: ${json.error}`)
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

  const {
    currentPage, pageSize, totalPages,
    paginatedItems, setCurrentPage, setPageSize,
  } = usePagination({
    items: documents,
    defaultPageSize: 15,
    resetDeps: [activeTab],
  })

  return (
    <div className="space-y-4  px-6 py-6">

      {/* Header */}
      <h1 className="text-2xl font-bold text-slate-900">Forwarded Files</h1>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-slate-200">
        {(['pending', 'saved', 'dismissed'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
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
              onSave={handleSave}
              onDismiss={handleDismiss}
              onToggleExpand={toggleExpand}
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

          {/* Pagination */}
          {!loading && documents.length > pageSize && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={documents.length}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[10, 15, 25, 50]}
            />
          )}
        </div>
      )}
    </div>
  )
}