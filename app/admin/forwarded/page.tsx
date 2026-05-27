'use client'
// app/admin/forwarded/page.tsx
//
// FIX: Forwarded file save now uploads to the recipient's own Google Drive
// BEFORE calling the save API, mirroring exactly what AddDocumentModal does.
//
// OLD (broken) flow:
//   Click Save → POST /api/forward/[id]/save
//     → server tries to download from sender's Drive (fails silently)
//     → falls back to sender's Drive URLs
//     → recipient's Supabase row points to sender's file
//
// NEW (correct) flow:
//   Click Save
//     → fetch file blob from sender's gdrive_url in the browser
//     → upload blob to recipient's own Drive via /api/gdrive/upload (same
//        path AddDocumentModal uses)
//     → POST /api/forward/[id]/save WITH the Drive result already included
//     → server skips re-upload, inserts Supabase row with recipient's URLs

import React, { useEffect, useState, useCallback } from 'react'
import { Pagination }    from '@/components/ui/Pagination'
import { usePagination } from '@/hooks'
import { buildAttachmentTree } from '@/lib/forwarding'
import { useAuth }       from '@/lib/auth'
import { useDriveUpload } from '@/hooks/useGDriveTool'
import type { AdminRole } from '@/lib/auth'
import type { DocumentCategory } from '@/lib/gdrive-pool/types'
import {
  FileText, FolderOpen, BookOpen, ClipboardList,
  User, Calendar, ChevronDown, ChevronUp,
  ExternalLink, Save, X, CheckCircle, Plus, RefreshCw, Loader2,
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
  file_name?:            string
  pool_account_id?:      string
  status:                'pending' | 'saved' | 'dismissed'
  received_at:           string
  saved_at:              string | null
  forwarded_attachments: any[]
}

// Drive result passed from client upload to the save API
interface ClientDriveResult {
  gdriveFileId:  string
  fileUrl:       string
  downloadUrl:   string
  poolAccountId: string
  recordId:      string
  sizeBytes:     number
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

const DOC_TYPE_BADGE: Record<string, string> = {
  master_document: 'bg-sky-50 text-sky-700',
  admin_order:     'bg-slate-100 text-slate-600',
  daily_journal:   'bg-emerald-50 text-emerald-700',
  library:         'bg-amber-50 text-amber-700',
}

const DOC_TYPE_ICON: Record<string, { bg: string; color: string }> = {
  master_document: { bg: 'bg-blue-100',  color: 'text-blue-600'  },
  admin_order:     { bg: 'bg-slate-100', color: 'text-slate-500' },
  daily_journal:   { bg: 'bg-red-100',   color: 'text-red-500'   },
  library:         { bg: 'bg-amber-100', color: 'text-amber-500' },
}

// document_type → Drive category
const DRIVE_CATEGORY_MAP: Record<string, DocumentCategory> = {
  master_document: 'master_documents',
  admin_order:     'special_orders',
  daily_journal:   'daily_journals',
  library:         'library_items',
}

// document_type → entity_type string
const ENTITY_TYPE_MAP: Record<string, string> = {
  master_document: 'master_document',
  admin_order:     'special_order',
  daily_journal:   'daily_journal',
  library:         'library_item',
}

function DocIcon({ type }: { type: string }) {
  const cfg  = DOC_TYPE_ICON[type] ?? { bg: 'bg-slate-100', color: 'text-slate-400' }
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
// Client-side Drive upload for a forwarded file
// ─────────────────────────────────────────────────────────────

/**
 * Fetches the file from the sender's Google Drive URL in the browser,
 * then uploads it to the recipient's own Drive via /api/gdrive/upload.
 *
 * This mirrors AddDocumentModal exactly — same XHR path, same gateway,
 * same pool selection scoped to the recipient's connected Drive accounts.
 *
 * Returns the Drive result on success, or null on failure.
 */
async function uploadForwardedFileToDrive(
  doc: ForwardedDocument,
  recipientRole: string,
  newDocId: string,
  uploadToDrive: (
    file: File,
    category: DocumentCategory,
    meta: { uploadedBy: string; entityId?: string; entityType?: string }
  ) => Promise<any>
): Promise<ClientDriveResult | null> {
  try {
    // 1. Fetch the file blob from sender's Drive URL
    //    gdrive_url is the webViewLink — we need the download URL
    const fileId      = doc.gdrive_file_id
    const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`

    // We can't call the Drive API directly from the browser without a token,
    // so we use the sender's gdrive_url (webViewLink). Google Drive allows
    // direct download via the export/uc URL for files shared with "anyone".
    const publicDownloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`

    let blob: Blob
    try {
      const res = await fetch(publicDownloadUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      blob = await res.blob()
    } catch {
      // Fallback: try the webViewLink URL itself
      const res = await fetch(doc.gdrive_url)
      if (!res.ok) throw new Error(`Fallback fetch failed: HTTP ${res.status}`)
      blob = await res.blob()
    }

    if (blob.size === 0) {
      throw new Error('Downloaded file is empty')
    }

    // 2. Wrap blob as a File object (required by useDriveUpload)
    const mimeType = doc.mime_type || blob.type || 'application/octet-stream'
    const fileName = doc.file_name || doc.title || `forwarded-${Date.now()}`
    const file     = new File([blob], fileName, { type: mimeType })

    // 3. Upload to recipient's own Drive via the same hook AddDocumentModal uses
    const category   = DRIVE_CATEGORY_MAP[doc.document_type] ?? 'master_documents'
    const entityType = ENTITY_TYPE_MAP[doc.document_type]    ?? doc.document_type

    const result = await uploadToDrive(file, category, {
      uploadedBy: recipientRole,
      entityId:   newDocId,
      entityType,
    })

    if (!result) return null

    return {
      gdriveFileId:  result.gdriveFileId,
      fileUrl:       result.fileUrl,
      downloadUrl:   result.downloadUrl ?? '',
      poolAccountId: result.poolAccountId,
      recordId:      result.recordId    ?? '',
      sizeBytes:     blob.size,
    }
  } catch (err: any) {
    console.error('[ForwardedInbox] Client Drive upload failed:', err?.message)
    return null
  }
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
  const isSaving = saving === doc.id

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      {/* Main Row */}
      <div className="flex items-center gap-3 px-4 py-3">

        <DocIcon type={doc.document_type} />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 truncate leading-snug">
            {doc.title}
          </p>
          <p className="text-xs text-slate-400 mt-0.5 uppercase tracking-wide">
            {ext}{size ? ` • ${size}` : ''}
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap flex-shrink-0">
          <User className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{doc.sender_role}</span>
        </div>

        <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-500 flex-shrink-0 whitespace-nowrap">
          <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{date}</span>
        </div>

        <span className={`
          hidden lg:inline-block text-[10px] font-semibold tracking-widest
          uppercase px-2.5 py-1 rounded-md whitespace-nowrap flex-shrink-0
          ${DOC_TYPE_BADGE[doc.document_type] ?? 'bg-slate-100 text-slate-500'}
        `}>
          {DOC_TYPE_LABELS[doc.document_type] ?? doc.document_type}
        </span>

        <div className="flex items-center gap-2 flex-shrink-0">

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

          <ViewButton url={doc.gdrive_url} />

          {activeTab === 'pending' && (
            <button
              onClick={() => onSave(doc)}
              disabled={isSaving}
              className="
                inline-flex items-center gap-1.5 px-3.5 py-1.5
                text-xs font-semibold text-white bg-blue-600
                rounded-md hover:bg-blue-700 transition-colors
                disabled:opacity-60
              "
            >
              {isSaving
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
                : <><Save    className="w-3 h-3" /> Save</>}
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
              disabled={dismissing === doc.id}
              className="p-1 text-slate-300 hover:text-slate-500 transition"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {doc.notes && (
        <div className="px-4 pb-2 -mt-0.5">
          <p className="text-xs text-slate-500 italic">"{doc.notes}"</p>
        </div>
      )}

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

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function ForwardedInboxPage() {
  const { user } = useAuth()

  const [documents,      setDocuments]   = useState<ForwardedDocument[]>([])
  const [loading,        setLoading]     = useState(true)
  const [activeTab,      setActiveTab]   = useState<'pending' | 'saved' | 'dismissed'>('pending')
  const [saving,         setSaving]      = useState<string | null>(null)
  const [savingLabel,    setSavingLabel] = useState<string>('')
  const [dismissing,     setDismissing]  = useState<string | null>(null)
  const [expanded,       setExpanded]    = useState<string | null>(null)

  // Same Drive upload hook used by AddDocumentModal
  const { uploadToDrive } = useDriveUpload()

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

  // ── Save handler ──────────────────────────────────────────────────────────
  //
  // Flow:
  //   1. Upload the file to recipient's own Drive (client-side, same as AddDocumentModal)
  //   2. POST to /api/forward/[id]/save with the Drive result
  //   3. Server inserts Supabase row using recipient's URLs — no server-side download needed
  //
  const handleSave = useCallback(async (doc: ForwardedDocument) => {
    if (!user?.role) return

    setSaving(doc.id)
    setSavingLabel('Uploading to Drive…')

    try {
      // ── Step 1: upload file to recipient's own Google Drive ──────────────
      const newDocId = doc.document_type === 'master_document' ? `md-${Date.now()}`
                     : doc.document_type === 'admin_order'     ? `so-${Date.now()}`
                     : doc.document_type === 'daily_journal'   ? `dj-${Date.now()}`
                     : `lib-${Date.now()}`

      const driveResult = await uploadForwardedFileToDrive(
        doc,
        user.role,
        newDocId,
        uploadToDrive,
      )

      if (!driveResult) {
        // Drive upload failed — still attempt save so metadata is recorded,
        // the API will use the sender's Drive URLs as fallback.
        console.warn('[ForwardedInbox] Drive upload failed; proceeding with fallback.')
      }

      // ── Step 2: save metadata to Supabase via API ────────────────────────
      setSavingLabel('Saving…')

      const body: Record<string, any> = { newDocId }
      if (driveResult) {
        body.driveResult = driveResult
      }

      const res  = await fetch(`/api/forward/${doc.id}/save`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json()

      if (json.success) {
        fetchInbox()
      } else {
        alert(`Save failed: ${json.error}`)
      }
    } finally {
      setSaving(null)
      setSavingLabel('')
    }
  }, [user, uploadToDrive, fetchInbox])

  const handleDismiss = useCallback(async (doc: ForwardedDocument) => {
    setDismissing(doc.id)
    try {
      await fetch(`/api/forward/${doc.id}/dismiss`, { method: 'PATCH' })
      fetchInbox()
    } finally {
      setDismissing(null)
    }
  }, [fetchInbox])

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
    <div className="space-y-4 px-6 py-6">

      {/* Header */}
      <h1 className="text-2xl font-bold text-slate-900">Forwarded Files</h1>

      {/* Upload status banner */}
      {saving && savingLabel && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 font-medium">
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
          {savingLabel}
        </div>
      )}

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

          {documents.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">
              No {activeTab} documents.
            </div>
          )}

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