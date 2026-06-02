'use client'
// app/admin/master/page.tsx
//
// FIX (upload access):
//   Previously relied on UploadGuard which used assertCanUpload (P1-only).
//   Now uses canUploadDocuments() from permissions.ts which allows P1–P10,
//   WCPD, and PPSMU to upload.
//
// FIX (per-user visibility):
//   loadAll filters getMasterDocuments() by uploaded_by = user.role so each
//   account only sees documents they personally uploaded.
//   Privileged roles (admin, DPDA, DPDO) still see everything.
//
// FIX (attachment upload):
//   handleUpload now routes attachment files through the Drive pool gateway
//   (/api/gdrive/upload) instead of supabase.storage. The Drive file ID,
//   URL, and pool account ID are stored in master_document_attachments.

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { PageHeader }       from '@/components/ui/PageHeader'
import { Badge }            from '@/components/ui/Badge'
import { Button }           from '@/components/ui/Button'
import { SearchInput }      from '@/components/ui/SearchInput'
import { ConfirmDialog }    from '@/components/ui/ConfirmDialog'
import { EmptyState }       from '@/components/ui/EmptyState'
import { ToolbarSelect }    from '@/components/ui/Toolbar'
import { Modal }            from '@/components/ui/Modal'
import { Pagination }       from '@/components/ui/Pagination'
import { AddDocumentModal } from '@/components/modals/AddDocumentModal'
import { ApprovalWorkflowModal }  from '@/components/modals/ApprovalWorkflowModal'
import { ForwardDocumentModal } from '@/components/modals/ForwardDocumentModal'
import { useModal, useDisclosure, usePagination } from '@/hooks'
import { useToast }         from '@/components/ui/Toast'
import { useAuth }          from '@/lib/auth'
import { levelBadgeClass }  from '@/lib/utils'
import { supabase }         from '@/lib/supabase'
import { useRealtimeMasterDocs } from './useRealtimeMasterDocs'
import { FileText, Paperclip, Eye, Download, FolderOpen, Pencil, Trash2, Printer, Send, Archive, ChevronRight, X } from 'lucide-react'
import {
  getMasterDocuments, addMasterDocument, updateMasterDocument,
  archiveMasterDocument, deleteMasterDocument, addArchivedDoc, getArchivedDocs,
  deleteDriveFile,
} from '@/lib/data'
import {
  getApproval,
  createApproval,
  type DocumentApproval,
} from '@/lib/rbac'
import { logDeleteDocument, logEditDocument, logRenameAttachment, logArchiveDocument } from '@/lib/adminLogger'
import { hasFullDocumentAccess, canUploadDocuments } from '@/lib/permissions'
import type { MasterDocument, DocLevel } from '@/types'
import type { AdminRole } from '@/lib/auth'

type DocWithUrl = MasterDocument & { fileUrl?: string; uploaded_by?: string }
type DocEnriched = DocWithUrl & {
  approval?: DocumentApproval | null
  created_at?: string
  children?: DocEnriched[]
}

type AttachmentNavEntry =
  | { kind: 'document';   doc: DocEnriched }
  | { kind: 'attachment'; att: DocAttachment }

export interface DocAttachment {
  id: string
  master_document_id: string
  parent_id: string | null
  depth: number
  title: string
  file_name: string | null
  file_size_bytes: number | null
  mime_type: string | null
  gdrive_file_id: string
  gdrive_url: string
  pool_account_id: string
  created_at: string
}

// ── Drive attachment upload result ────────────────────────────────────────────
interface DriveAttachmentResult {
  gdriveFileId:  string
  gdrive_url:    string
  poolAccountId: string
  fileSizeBytes: number
}

// ── Privileged roles that see ALL documents regardless of uploader ────────────
const PRIVILEGED_ROLES = ['admin', 'DPDA', 'DPDO']
function canSeeAllDocuments(role: string): boolean {
  return PRIVILEGED_ROLES.includes(role)
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function displayName(att: DocAttachment): string {
  return att.title || att.file_name || att.gdrive_file_id
}

function normaliseAttachment(row: any): DocAttachment {
  return {
    id:                  row.id,
    master_document_id:  row.master_document_id,
    parent_id:           row.parent_id ?? null,
    depth:               row.depth ?? 0,
    title:               row.title ?? '',
    file_name:           row.file_name ?? null,
    file_size_bytes:     row.file_size_bytes ?? null,
    mime_type:           row.mime_type ?? null,
    gdrive_file_id:      row.gdrive_file_id,
    gdrive_url:          row.gdrive_url,
    pool_account_id:     row.pool_account_id,
    created_at:          row.created_at,
  }
}

async function dbAddAttachment(att: Omit<DocAttachment, 'id' | 'created_at'>): Promise<DocAttachment | null> {
  const { data, error } = await supabase
    .from('master_document_attachments')
    .insert(att)
    .select().single()
  if (error) { console.error('addAttachment error:', error.message); return null }
  return normaliseAttachment(data)
}

async function dbDeleteAttachment(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('master_document_attachments')
    .delete()
    .eq('id', id)
  if (error) { console.error('deleteAttachment error:', error.message); return false }
  return true
}

async function dbRenameAttachment(id: string, newTitle: string): Promise<boolean> {
  const { error } = await supabase
    .from('master_document_attachments')
    .update({ title: newTitle })
    .eq('id', id)
  if (error) { console.error('renameAttachment error:', error.message); return false }
  return true
}

// ── Drive pool upload helper ───────────────────────────────────────────────────
// Replaces the old supabase.storage.from('documents').upload() pattern.
// Sends the file to /api/gdrive/upload which routes it through the pool
// gateway into the uploading user's own connected Google Drive account.
async function uploadAttachmentToDrive(
  file: File,
  uploadedBy: string,
  parentDocId: string,
  parentAttId: string | null,
): Promise<DriveAttachmentResult | null> {
  const formData = new FormData()
  formData.append('file',        file)
  formData.append('category',    'master_documents')
  formData.append('uploadedBy',  uploadedBy)
  formData.append('entityType',  parentAttId ? 'master_document_attachment' : 'master_document')
  formData.append('entityId',    parentAttId ?? parentDocId)

  try {
    const res = await fetch('/api/gdrive/upload', { method: 'POST', body: formData })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      console.error('[uploadAttachmentToDrive] API error:', json.error ?? res.status)
      return null
    }

    const json = await res.json()
    const r    = json.data

    if (!r?.gdriveFileId && !r?.gdrive_file_id) {
      console.error('[uploadAttachmentToDrive] Missing gdriveFileId in response', r)
      return null
    }

    return {
      gdriveFileId:  r.gdriveFileId  ?? r.gdrive_file_id,
      gdrive_url:    r.fileUrl       ?? r.drive_url ?? `https://drive.google.com/file/d/${r.gdriveFileId}/view`,
      poolAccountId: r.poolAccountId ?? r.pool_account_id,
      fileSizeBytes: r.sizeBytes     ?? file.size,
    }
  } catch (err: any) {
    console.error('[uploadAttachmentToDrive] Network error:', err.message)
    return null
  }
}

function fileInfoFromMime(mimeType: string | null, fileName: string | null) {
  const name = fileName ?? ''
  const mime = mimeType ?? ''
  if (mime === 'application/pdf' || name.match(/\.pdf$/i))
    return { icon: '📕', label: 'PDF',  badgeCls: 'bg-red-100 text-red-700' }
  if (mime.includes('wordprocessingml') || name.match(/\.docx?$/i))
    return { icon: '📘', label: 'DOCX', badgeCls: 'bg-blue-100 text-blue-700' }
  if (mime.includes('spreadsheetml') || name.match(/\.xlsx?$/i))
    return { icon: '📗', label: 'XLSX', badgeCls: 'bg-green-100 text-green-700' }
  if (mime.startsWith('image/') || name.match(/\.(jpg|jpeg|png|webp)$/i))
    return { icon: '🖼️', label: 'IMG',  badgeCls: 'bg-violet-100 text-violet-700' }
  return { icon: '📄', label: 'FILE', badgeCls: 'bg-slate-100 text-slate-600' }
}

function Breadcrumb({
  navStack, onNavigateTo,
}: {
  navStack: AttachmentNavEntry[]
  onNavigateTo: (index: number) => void
}) {
  if (navStack.length <= 1) return null
  return (
    <div className="flex items-center gap-0 flex-wrap mb-4 px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl">
      <span className="text-slate-400 mr-1 text-sm">🗂</span>
      {navStack.map((entry, i) => {
        const label = entry.kind === 'document' ? `${entry.doc.tag} – ${entry.doc.title}` : displayName(entry.att)
        const isLast = i === navStack.length - 1
        const fi = entry.kind === 'attachment' ? fileInfoFromMime(entry.att.mime_type, entry.att.file_name) : null
        return (
          <span key={i} className="flex items-center">
            {i > 0 && <span className="mx-1.5 text-slate-400 font-bold text-sm select-none">›</span>}
            {isLast ? (
              <span className="flex items-center gap-1 text-[13px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg" title={label}>
                {fi && <Paperclip size={14} className="flex-shrink-0 text-blue-600" />}
                <span className="truncate max-w-[180px]">{label.length > 28 ? label.slice(0, 27) + '…' : label}</span>
              </span>
            ) : (
              <button onClick={() => onNavigateTo(i)}
                className="flex items-center gap-1 text-[13px] font-semibold text-slate-600 hover:text-blue-700 hover:bg-white border border-transparent hover:border-blue-200 px-2 py-1 rounded-lg transition-all"
                title={`Go back to ${label}`}>
                {fi && <Paperclip size={14} className="flex-shrink-0 text-blue-600" />}
                <span className="truncate max-w-[140px]">{label.length > 20 ? label.slice(0, 19) + '…' : label}</span>
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}

function getExtensionFromUrl(fileUrl: string) {
  const cleanUrl = fileUrl.split('?')[0].split('#')[0]
  const match = cleanUrl.match(/\.([a-z0-9]+)$/i)
  return match?.[1]?.toLowerCase() ?? ''
}

function getSuggestedFileName(baseName: string, fileUrl: string) {
  if (/\.[a-z0-9]+$/i.test(baseName)) return baseName
  const ext = getExtensionFromUrl(fileUrl)
  return ext ? `${baseName}.${ext}` : baseName
}

async function saveFileFromUrl(fileUrl: string, suggestedName: string): Promise<boolean> {
  const response = await fetch(fileUrl)
  if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`)
  const blob = await response.blob()
  const picker = window as Window & {
    showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle>
  }
  if (picker.showSaveFilePicker) {
    const handle = await picker.showSaveFilePicker({ suggestedName })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return true
  }
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = suggestedName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
  return false
}

async function printFileFromUrl(fileUrl: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0'
    let settled = false
    let blobUrl: string | null = null
    const cleanup = () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      fn()
    }
    const timeout = window.setTimeout(() => {
      finish(() => { cleanup(); reject(new Error('Print timed out.')) })
    }, 15000)
    fetch(fileUrl)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() })
      .then(blob => {
        blobUrl = URL.createObjectURL(blob)
        iframe.src = blobUrl
        iframe.onload = () => {
          const target = iframe.contentWindow
          if (!target) { finish(() => { cleanup(); reject(new Error('Unable to load printable content.')) }); return }
          window.setTimeout(() => {
            finish(() => {
              try { target.focus(); target.print(); resolve() }
              catch (e) { reject(e instanceof Error ? e : new Error('Print failed.')) }
              finally { window.setTimeout(cleanup, 1200) }
            })
          }, 500)
        }
        iframe.onerror = () => finish(() => { cleanup(); reject(new Error('Could not load file for printing.')) })
        document.body.appendChild(iframe)
      })
      .catch(e => finish(() => { cleanup(); reject(e instanceof Error ? e : new Error('Failed to prepare file for printing.')) }))
  })
}

// ── Inline File Viewer ──────────────────────────────────────────────────────
function InlineFileViewerModal({ fileUrl, fileName, open, onClose, onDownload, onPrint }: {
  fileUrl: string; fileName: string; open: boolean; onClose: () => void
  onDownload?: (fileUrl: string, fileName: string) => Promise<void>
  onPrint?: (fileUrl: string, fileName: string) => Promise<void>
}) {
  const { toast } = useToast()
  const [isDownloading, setIsDownloading] = useState(false)
  const isPDF   = !!fileUrl.match(/\.pdf(\?|$)/i)
  const isImage = !!fileUrl.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)
  const fi      = fileInfoFromMime(null, fileName)

  async function handleDownload() {
    try {
      setIsDownloading(true)
      if (onDownload) { await onDownload(fileUrl, fileName) }
      else { await saveFileFromUrl(fileUrl, getSuggestedFileName(fileName, fileUrl)); toast.success(`Downloaded "${fileName}" successfully.`) }
    } catch { toast.error('Could not download the file.') }
    finally { setIsDownloading(false) }
  }

  async function handlePrint() {
    try {
      setIsDownloading(true)
      if (onPrint) { await onPrint(fileUrl, fileName); return }
      await printFileFromUrl(fileUrl)
      toast.success('Opened print dialog.')
    } catch { toast.error('Could not print the file.') }
    finally { setIsDownloading(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Viewing: ${fileName}`} width="max-w-5xl">
      <div className="flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">{fi.icon}</span>
            <p className="text-xs font-semibold text-slate-700 truncate max-w-sm">{fileName}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
            <button type="button" onClick={handleDownload} disabled={isDownloading}
              className="text-[11px] font-semibold px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition disabled:opacity-60">
              {isDownloading ? '⬇ Saving…' : '⬇ Download'}
            </button>
            <button type="button" onClick={handlePrint} disabled={isDownloading}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition disabled:opacity-60">
              <Printer size={13} /> Print
            </button>
            <Button variant="outline" size="sm" onClick={onClose} className="inline-flex items-center gap-1.5"><X size={16} />Close</Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-slate-100 min-h-0" style={{ minHeight: 400 }}>
          {isPDF ? (
            <iframe src={fileUrl} title={fileName} className="w-full border-0" style={{ height: '75vh', minHeight: 400 }} />
          ) : isImage ? (
            <div className="flex items-center justify-center p-6 min-h-96">
              <img src={fileUrl} alt={fileName} className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-md border border-slate-200 bg-white" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
              <span className="text-6xl mb-4">{fi.icon}</span>
              <p className="text-sm font-semibold text-slate-700 mb-1 break-all">{fileName}</p>
              <p className="text-xs text-slate-400 mb-5 max-w-xs">Preview not available. Download to view the file.</p>
              <button type="button" onClick={handleDownload} disabled={isDownloading}
                className="inline-flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-blue-700 transition disabled:opacity-60">
                {isDownloading ? '⬇ Saving…' : '⬇ Download to view'}
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ── Edit Modal ──────────────────────────────────────────────────────────────
function EditModal({ doc, open, onClose, onSave }: {
  doc: DocEnriched | null; open: boolean; onClose: () => void
  onSave: (updated: DocWithUrl) => void
}) {
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [level, setLevel] = useState<DocLevel>('REGIONAL')
  const [date,  setDate]  = useState('')
  const [type,  setType]  = useState('PDF')

  useEffect(() => {
    if (doc) { setTitle(doc.title); setLevel(doc.level); setDate(doc.date); setType(doc.type) }
  }, [doc])

  function submit() {
    if (!title.trim()) { toast.error('Title is required.'); return }
    if (!doc) return
    onSave({ ...doc, title: title.trim(), level, date, type })
  }

  const cls = 'w-full px-3 py-2.5 border-[1.5px] border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition'
  return (
    <Modal open={open} onClose={onClose} title="Edit Document" width="max-w-lg">
      <div className="p-6 space-y-4">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Title <span className="text-red-500">*</span></label>
          <input className={cls} value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Level</label>
            <select className={cls} value={level} onChange={e => setLevel(e.target.value as DocLevel)}>
              <option value="REGIONAL">Regional</option>
              <option value="PROVINCIAL">Provincial</option>
              <option value="STATION">Station</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Date</label>
            <input type="date" className={cls} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">File Type</label>
            <select className={cls} value={type} onChange={e => setType(e.target.value)}>
              <option value="PDF">PDF</option>
              <option value="DOCX">DOCX</option>
              <option value="XLSX">XLSX</option>
              <option value="Image">Image</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2.5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>💾 Save</Button>
        </div>
      </div>
    </Modal>
  )
}

interface FlatNode { doc: DocEnriched; depth: number }
function flattenDocs(docs: DocEnriched[], depth = 0): FlatNode[] {
  return docs.flatMap(doc => [
    { doc, depth },
    ...(doc.children ? flattenDocs(doc.children as DocEnriched[], depth + 1) : []),
  ])
}

// ══════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════

export default function MasterPage() {
  const { toast } = useToast()
  const { user }  = useAuth()

  // FIX: use canUploadDocuments (P1–P10, WCPD, PPSMU) instead of P1-only check
  const canUpload          = user?.role ? canUploadDocuments(user.role as AdminRole) : false
  const isP1               = user?.role === 'P1'
  const isPrivileged       = user ? hasFullDocumentAccess(user.role as AdminRole) : false
  const canModifyDocuments = user ? !['DPDA', 'DPDO'].includes(user.role) : false

  const [documents,      setDocuments]      = useState<DocEnriched[]>([])
  const [query,          setQuery]          = useState('')
  const [levelFilter,    setLevel]          = useState<DocLevel | 'ALL'>('ALL')
  const [loading,        setLoading]        = useState(true)
  const [attachmentsMap, setAttachmentsMap] = useState<Map<string, DocAttachment[]>>(new Map())
  const [selection,      setSelection]      = useState<DocEnriched | null>(null)
  const [uploadingId,    setUploadingId]    = useState<string | null>(null)
  const [viewerFile,     setViewerFile]     = useState<{ url: string; name: string; sourceDocumentId?: string } | null>(null)
  const [activeApproval, setActiveApproval] = useState<DocumentApproval | null>(null)
  const [forwardModalOpen, setForwardModalOpen] = useState(false)
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [editingAttachmentId,   setEditingAttachmentId]   = useState<string | null>(null)
  const [editingAttachmentName, setEditingAttachmentName] = useState('')
  const [renamingAttachmentId,  setRenamingAttachmentId]  = useState<string | null>(null)
  const [isArchiving,           setIsArchiving]           = useState(false)
  const [isDeleting,            setIsDeleting]            = useState(false)

  const deleteAttDisc  = useDisclosure<DocAttachment>()
  const uploadModal    = useModal()
  const editModal      = useModal()
  const archiveDisc    = useDisclosure<string>()
  const deleteDisc     = useDisclosure<string>()
  const approvalModal  = useModal()
  const [attachmentNavStack, setAttachmentNavStack] = useState<AttachmentNavEntry[]>([])

  useRealtimeMasterDocs({ setDocuments, setAttachmentsMap, user, isPrivileged, isP1 })

  const handleDownloadFile = useCallback(async (
    fileUrl: string, suggestedName: string, downloadKey: string, sourceDocumentId?: string,
  ) => {
    try {
      setDownloadingKey(downloadKey)
      await saveFileFromUrl(fileUrl, suggestedName)
      toast.success(`Downloaded "${suggestedName}" successfully.`)
    } catch { toast.error('Could not download the file.') }
    finally { setDownloadingKey(current => current === downloadKey ? null : current) }
  }, [toast])

  const handlePrintFile = useCallback(async (fileUrl: string, fileName: string, _sourceDocumentId?: string) => {
    try {
      await printFileFromUrl(fileUrl)
      toast.success(`Opened print preview for "${fileName}".`)
    } catch { toast.error('Could not print the file.') }
  }, [toast])

  // Load — filter by uploaded_by unless user is privileged
  useEffect(() => {
    async function loadAll() {
      if (!user) return
      try {
        const [docs, archived] = await Promise.all([getMasterDocuments(), getArchivedDocs()])
        const archivedIds = new Set(
          (archived ?? [])
            .map((a: any) => String(a.id ?? ''))
            .filter((id: string) => id.startsWith('arc-md-'))
            .map((id: string) => id.replace('arc-md-', ''))
        )

        // Privileged roles see all; everyone else sees only their own uploads.
        const activeDocs = docs.filter((d: DocWithUrl) => {
          if (archivedIds.has(d.id)) return false
          if (canSeeAllDocuments(user.role)) return true
          return d.uploaded_by === user.role
        })

        const enriched: DocEnriched[] = await Promise.all(
          activeDocs.map(async (doc: DocWithUrl) => {
            const approval = await getApproval(doc.id, 'master')
            return { ...doc, approval }
          })
        )
        setDocuments(enriched)

        if (docs.length > 0) {
          const { data: allAtts } = await supabase
            .from('master_document_attachments')
            .select('*')
            .in('master_document_id', docs.map((d: DocWithUrl) => d.id))
            .order('created_at', { ascending: true })

          const map = new Map<string, DocAttachment[]>()
          for (const row of (allAtts ?? [])) {
            const att = normaliseAttachment(row)
            const key = att.parent_id ?? att.master_document_id
            const list = map.get(key) ?? []
            list.push(att)
            map.set(key, list)
          }
          setAttachmentsMap(map)
        }

        if (enriched.length > 0) setSelection(enriched[0])
      } catch (err) {
        console.error('loadAll error:', err)
      } finally {
        setLoading(false)
      }
    }
    loadAll()
  }, [user, isPrivileged, isP1])

  useEffect(() => {
    if (selection) {
      setAttachmentNavStack([{ kind: 'document', doc: selection }])
    } else {
      setAttachmentNavStack([])
    }
  }, [selection?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd(newDoc: DocWithUrl) {
    await addMasterDocument(newDoc)
    await createApproval(newDoc.id, 'master', newDoc.title)
    const enriched: DocEnriched = { ...newDoc, approval: null }
    setDocuments(prev => {
      if (prev.some(d => d.id === enriched.id)) return prev.map(d => d.id === enriched.id ? { ...d, ...enriched } : d)
      return [...prev, enriched]
    })
    setAttachmentsMap(prev => { const next = new Map(prev); next.set(newDoc.id, []); return next })
    setSelection(enriched)
  }

  async function handleSave(updated: DocWithUrl) {
    await updateMasterDocument(updated)
    await logEditDocument(updated.title)
    setDocuments(prev => prev.map(d => d.id === updated.id ? { ...d, ...updated } : d))
    if (selection?.id === updated.id) setSelection(prev => prev ? { ...prev, ...updated } : prev)
    toast.success('Document updated.')
    editModal.close()
  }

  async function handleArchiveDoc() {
    if (!selection) return
    setIsArchiving(true)
    try {
      const doc  = selection
      const date = new Date().toISOString().split('T')[0]

      // Step 1: Move file in Google Drive to the archive folder
      // Only attempt if we have the Drive metadata
      const gdriveFileId  = (doc as any).gdrive_file_id
      const poolAccountId = (doc as any).pool_account_id

      if (gdriveFileId && poolAccountId) {
        const res = await fetch('/api/gdrive/archive', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            gdriveFileId,
            poolAccountId,
            category: 'master_documents',
          }),
        })

        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          toast.error(`Could not move file to Drive archive: ${json.error ?? 'Unknown error'}`)
          // Don't block the rest — still archive the record
        }
      }

      // Step 2: Add to archived_docs table
      await addArchivedDoc({
        id:          `arc-md-${doc.id}`,
        title:       doc.title,
        type:        'Master Document',
        archivedDate: date,
        archivedBy:  user?.role ?? 'P1',
      })

      // Step 3: Mark as archived in master_documents
      // Update archiveMasterDocument in lib/data.ts to actually set archived = true
      await archiveMasterDocument(doc.id)

      await logArchiveDocument(doc.title, 'master document')

      // Step 4: Remove from UI
      setDocuments(prev => prev.filter(d => d.id !== doc.id))
      setSelection(null)
      toast.success('Document archived.')
      archiveDisc.close()
    } finally {
      setIsArchiving(false)
    }
  }

    async function handleDeleteDoc() {
      if (!selection) return
      const doc = selection
      setIsDeleting(true)
      try {
        await deleteDriveFile(
          (doc as any).gdrive_file_id,
          (doc as any).pool_account_id
        )
        await deleteMasterDocument(doc.id)
        await logDeleteDocument(doc.title, 'master document')
        setDocuments(prev => prev.filter(d => d.id !== doc.id))
        setSelection(null)
        toast.success('Document deleted permanently.')
        deleteDisc.close()
      } finally {
        setIsDeleting(false)
      }
    }

  // FIX: Attachment upload now routes through the Drive pool gateway.
  // Previously used supabase.storage.from('documents').upload() which stored
  // files in Supabase Storage. Now files go to the uploading user's own
  // connected Google Drive account via /api/gdrive/upload.
  async function handleUpload(parentDocId: string, parentAttId: string | null, files: FileList) {
    if (!user) { toast.error('Not authenticated.'); return }

    setUploadingId(parentAttId ?? parentDocId)
    let count = 0

    for (const file of Array.from(files)) {
      // Upload to Google Drive via the pool gateway
      const driveResult = await uploadAttachmentToDrive(
        file,
        user.role,
        parentDocId,
        parentAttId,
      )

      if (!driveResult) {
        toast.error(`Failed to upload "${file.name}" to Google Drive.`)
        continue
      }

      const parentDepth = parentAttId
        ? (() => {
            for (const list of attachmentsMap.values()) {
              const parent = list.find(a => a.id === parentAttId)
              if (parent) return parent.depth + 1
            }
            return 1
          })()
        : 0

      // Save metadata to Supabase — actual file lives in Google Drive
      const newAtt = await dbAddAttachment({
        master_document_id: parentDocId,
        parent_id:          parentAttId,
        depth:              parentDepth,
        title:              file.name,
        file_name:          file.name,
        file_size_bytes:    driveResult.fileSizeBytes,
        mime_type:          file.type || null,
        gdrive_file_id:     driveResult.gdriveFileId,
        gdrive_url:         driveResult.gdrive_url,
        pool_account_id:    driveResult.poolAccountId,
      })

      if (newAtt) {
        const mapKey = parentAttId ?? parentDocId
        setAttachmentsMap(prev => {
          const next = new Map(prev)
          const existing = next.get(mapKey) ?? []
          if (existing.some(a => a.id === newAtt.id)) return prev
          next.set(mapKey, [...existing, newAtt])
          return next
        })
        count++
      }
    }

    if (count > 0) toast.success(`${count} file${count > 1 ? 's' : ''} attached.`)
    setUploadingId(null)
  }

  async function handleDeleteAttachment() {
  const att = deleteAttDisc.payload
  if (!att) return
  setIsDeleting(true)
  try {
    await deleteDriveFile(att.gdrive_file_id, att.pool_account_id)
    const ok = await dbDeleteAttachment(att.id)
    if (!ok) { toast.error('Could not delete attachment.'); return }
    const mapKey = att.parent_id ?? att.master_document_id
    setAttachmentsMap(prev => {
      const next = new Map(prev)
      next.set(mapKey, (next.get(mapKey) ?? []).filter(a => a.id !== att.id))
      return next
    })
    setAttachmentNavStack(prev => {
      const idx = prev.findIndex(entry => entry.kind === 'attachment' && entry.att.id === att.id)
      return idx === -1 ? prev : prev.slice(0, idx)
    })
    toast.success(`"${displayName(att)}" deleted.`)
    deleteAttDisc.close()
  } finally {
    setIsDeleting(false)
  }
}

  async function handleRenameAttachment(att: DocAttachment, newTitle: string): Promise<boolean> {
    const trimmed = newTitle.trim()
    if (!trimmed) { toast.error('Title cannot be empty.'); return false }
    if (trimmed === att.title) return true
    const ok = await dbRenameAttachment(att.id, trimmed)
    if (!ok) { toast.error('Failed to rename attachment.'); return false }
    const mapKey = att.parent_id ?? att.master_document_id
    setAttachmentsMap(prev => {
      const next = new Map(prev)
      next.set(mapKey, (next.get(mapKey) ?? []).map(a => a.id === att.id ? { ...a, title: trimmed } : a))
      return next
    })
    await logRenameAttachment(att.title, trimmed)
    toast.success('Attachment renamed.')
    return true
  }

  const countActiveAttachments = useCallback((parentId: string): number => {
    const children = attachmentsMap.get(parentId) ?? []
    return children.reduce((total, att) => total + 1 + countActiveAttachments(att.id), 0)
  }, [attachmentsMap])

  const childCount = useCallback((attId: string): number => {
    const children = attachmentsMap.get(attId) ?? []
    return children.reduce((total, att) => total + 1 + childCount(att.id), 0)
  }, [attachmentsMap])

  const allFlat  = useMemo(() => flattenDocs(documents), [documents])
  const filtered = useMemo(() => allFlat.filter(({ doc }) => {
    const q = query.trim().toLowerCase()
    const matchesDocument = !q || doc.title.toLowerCase().includes(q)
    const matchesAttachment = q ? (() => {
      const searchNested = (parentId: string): boolean => {
        const items = attachmentsMap.get(parentId) ?? []
        return items.some(att =>
          (att.title.toLowerCase().includes(q) || (att.file_name ?? '').toLowerCase().includes(q)) ||
          searchNested(att.id)
        )
      }
      return searchNested(doc.id)
    })() : false
    return (matchesDocument || matchesAttachment) &&
           (levelFilter === 'ALL' || doc.level === levelFilter)
  }), [allFlat, query, levelFilter, attachmentsMap])

  const {
    currentPage,
    pageSize,
    totalPages,
    paginatedItems: paginatedDocs,
    setCurrentPage,
    setPageSize,
  } = usePagination({
    items: filtered,
    defaultPageSize: 25,
    resetDeps: [query, levelFilter],
  })

  const currentAttachmentEntry = attachmentNavStack.length > 0
    ? attachmentNavStack[attachmentNavStack.length - 1]
    : null

  const currentAttachments = useMemo((): DocAttachment[] => {
    if (!selection) return []
    if (currentAttachmentEntry?.kind === 'attachment') {
      return attachmentsMap.get(currentAttachmentEntry.att.id) ?? []
    }
    return (attachmentsMap.get(selection.id) ?? []).filter(a => !a.parent_id)
  }, [selection, attachmentsMap, currentAttachmentEntry])

  const filteredCurrentAttachments = useMemo((): DocAttachment[] => {
    const q = query.trim().toLowerCase()
    if (!q) return currentAttachments
    const searchNested = (parentId: string): boolean => {
      const items = attachmentsMap.get(parentId) ?? []
      return items.some(att =>
        (att.title.toLowerCase().includes(q) || (att.file_name ?? '').toLowerCase().includes(q)) ||
        searchNested(att.id)
      )
    }
    return currentAttachments.filter(att =>
      att.title.toLowerCase().includes(q) ||
      (att.file_name ?? '').toLowerCase().includes(q) ||
      searchNested(att.id)
    )
  }, [currentAttachments, query, attachmentsMap])

  const currentParentAttachment = currentAttachmentEntry?.kind === 'attachment'
    ? currentAttachmentEntry.att
    : null

  function handleSelectDocument(doc: DocEnriched) {
    setSelection(doc)
    setAttachmentNavStack([{ kind: 'document', doc }])
  }

  function handleDrillDown(att: DocAttachment) {
    setAttachmentNavStack(prev => [...prev, { kind: 'attachment', att }])
  }

  function handleNavigateTo(index: number) {
    setAttachmentNavStack(prev => prev.slice(0, index + 1))
  }

  return (
    <>
      <PageHeader title="Master Documents" />

      <div className="p-6 flex flex-col gap-5 flex-1" style={{ height: 'calc(100vh - 56px)' }}>
        <div className="bg-white border-[1.5px] border-slate-200 rounded-xl overflow-hidden flex flex-col flex-1 min-h-0">

          {/* Toolbar */}
          <div className="flex items-center gap-2.5 px-6 py-4 border-b border-slate-100 bg-slate-50 flex-shrink-0">
            <SearchInput value={query} onChange={setQuery} placeholder="Search documents and attachments…" className="max-w-xs flex-1" />
            <ToolbarSelect defaultValue="ALL" onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setLevel(e.target.value as DocLevel | 'ALL')}>
              <option value="ALL">All Levels</option>
              <option value="REGIONAL">Regional</option>
              <option value="PROVINCIAL">Provincial</option>
              <option value="STATION">Station</option>
            </ToolbarSelect>
            {/* FIX: Show Upload button for all allowed roles (P1–P10, WCPD, PPSMU) */}
            {canUpload && (
              <Button variant="primary" size="sm" className="ml-auto" onClick={uploadModal.open}>
                + Upload
              </Button>
            )}
          </div>

          {/* Split view */}
          <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* Left: document list */}
            <div className="flex-shrink-0 border-r border-slate-200 flex flex-col overflow-hidden" style={{ width: 280 }}>
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 leading-none">
                  Documents · {filtered.length}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">Click to view details</p>
              </div>

              <div className="flex-1 overflow-y-auto py-2 px-2">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : filtered.length === 0 ? (
                  <EmptyState icon="📁" title="No documents" description="No active master documents." />
                ) : (
                  paginatedDocs.map(({ doc, depth }) => {
                    const activeCount = countActiveAttachments(doc.id)
                    const levelColor = doc.level === 'REGIONAL' ? '#3b63b8' : doc.level === 'PROVINCIAL' ? '#f59e0b' : '#10b981'
                    const indentPx = depth * 16 + 8
                    const rowWidth = `calc(100% - ${indentPx + 8}px)`
                    return (
                      <div
                        key={doc.id}
                        style={{ marginLeft: indentPx, width: rowWidth }}
                        className={`flex items-center gap-1.5 pr-2 pl-2.5 py-2.5 rounded-lg mb-0.5 cursor-pointer transition ${
                          selection?.id === doc.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
                        }`}
                        onClick={() => handleSelectDocument(doc)}
                      >
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: levelColor }} />
                        <span className="flex-1 truncate text-[13px] font-medium">{doc.title}</span>
                        {activeCount > 0 && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 ${
                            selection?.id === doc.id ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-500'
                          }`}>
                            <Paperclip size={11} /> {activeCount}
                          </span>
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={filtered.length}
                pageSize={pageSize}
                onPageChange={setCurrentPage}
                onPageSizeChange={setPageSize}
                pageSizeOptions={[10, 25, 50]}
              />

              {/* Legend */}
              <div className="px-4 py-3 border-t border-slate-100 space-y-1.5 flex-shrink-0">
                {[{ color: '#3b63b8', label: 'Regional' }, { color: '#f59e0b', label: 'Provincial' }, { color: '#10b981', label: 'Station' }].map(l => (
                  <div key={l.label} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: l.color }} />
                    <span className="text-[11px] text-slate-400">{l.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: detail panel */}
            <div className="relative flex-1 min-h-0 overflow-hidden">
              <div className="h-full overflow-y-auto p-6 transition-all duration-200">
                {!selection ? (
                  <div className="h-full flex items-center justify-center">
                    <EmptyState icon="📄" title="Select a document" description="Click any document from the list to view its details." />
                  </div>
                ) : (
                  <div className="animate-fade-up space-y-5">

                    <Breadcrumb navStack={attachmentNavStack} onNavigateTo={handleNavigateTo} />

                    {/* Document header */}
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <h2 className="text-lg font-extrabold text-slate-800">{selection.title}</h2>
                          <Badge className={levelBadgeClass(selection.level)}>{selection.level}</Badge>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
                          {selection.created_at && (
                            <span className="bg-slate-100 px-2 py-0.5 rounded-full">
                              📅 {new Date(selection.created_at).toLocaleString('en-PH', {
                                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                              })}
                            </span>
                          )}
                          <span className="bg-slate-100 px-2 py-0.5 rounded-full">{selection.type} · {selection.size}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0 flex-wrap">
                        {canModifyDocuments && (
                          <>
                            <button onClick={() => setForwardModalOpen(true)} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-blue-600 border border-blue-700 rounded-lg hover:bg-blue-700 transition">
                              <Send size={16} />
                              Forward
                            </button>
                            <button onClick={editModal.open} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition">
                              <Pencil size={16} />
                              Edit
                            </button>
                            <button onClick={() => archiveDisc.open(selection.title)} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition">
                              <Archive size={16} />
                              Archive
                            </button>
                            <button onClick={() => deleteDisc.open(selection.title)} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition">
                              <Trash2 size={16} />
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Primary file */}
                    {selection.fileUrl ? (
                      <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <FileText size={18} className="flex-shrink-0 text-blue-600" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-blue-800 truncate">Primary file</p>
                          <p className="text-xs text-blue-600 truncate">{selection.title}.{selection.type.toLowerCase()}</p>
                        </div>
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button type="button"
                            onClick={() => handleDownloadFile(selection.fileUrl!, getSuggestedFileName(selection.title, selection.fileUrl!), `document-${selection.id}`, selection.id)}
                            disabled={downloadingKey === `document-${selection.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-blue-200 text-blue-600 rounded-md hover:bg-blue-50 transition disabled:opacity-60">
                            <Download size={13} />
                            {downloadingKey === `document-${selection.id}` ? 'Downloading…' : 'Download'}
                          </button>
                          <button type="button"
                            onClick={() => handlePrintFile(selection.fileUrl!, selection.title, selection.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-blue-200 text-blue-600 rounded-md hover:bg-blue-50 transition">
                            <Printer size={13} /> Print
                          </button>
                          <button
                            onClick={() => setViewerFile({ url: selection.fileUrl!, name: selection.title, sourceDocumentId: selection.id })}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-blue-200 text-blue-600 rounded-md hover:bg-blue-50 transition">
                            <Eye size={13} /> View
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {/* Attachments */}
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                        <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                          Attachments · {filteredCurrentAttachments.length}
                        </span>
                        <div className="flex items-center gap-2">
                          {uploadingId && (
                            <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
                              <span className="w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin block" />
                              Uploading to Drive…
                            </span>
                          )}
                          <input
                            ref={attachmentInputRef}
                            type="file"
                            multiple
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
                            className="hidden"
                            onChange={e => {
                              if (e.target.files && e.target.files.length > 0)
                                handleUpload(selection.id, currentParentAttachment?.id ?? null, e.target.files)
                              e.target.value = ''
                            }}
                          />
                          {canModifyDocuments && (
                            <Button variant="primary" size="sm" disabled={!!uploadingId}
                              onClick={() => attachmentInputRef.current?.click()}>
                              + Attach file
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Inline breadcrumb within panel */}
                      {attachmentNavStack.length > 1 && (
                        <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/70">
                          <div className="flex items-center gap-1 flex-wrap">
                            {attachmentNavStack.map((entry, i) => {
                              const isLast = i === attachmentNavStack.length - 1
                              const label = entry.kind === 'document' ? entry.doc.title : displayName(entry.att)
                              return (
                                <div key={`${entry.kind}-${i}`} className="flex items-center gap-1">
                                  {i > 0 && <span className="text-slate-300">›</span>}
                                  {isLast ? (
                                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 max-w-[220px] truncate">
                                      {label}
                                    </span>
                                  ) : (
                                    <button
                                      onClick={() => handleNavigateTo(i)}
                                      className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-white text-slate-600 border border-slate-200 hover:bg-slate-100 transition max-w-[180px] truncate"
                                    >
                                      {label}
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {filteredCurrentAttachments.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-center">
                          <FileText size={28} className="text-slate-300 mb-2" />
                          <p className="text-sm font-semibold text-slate-500">No attachments yet</p>
                          {canModifyDocuments && (
                            <>
                              <p className="text-xs text-slate-400 mt-1">Click + Attach file to upload supporting documents.</p>
                              <Button variant="outline" size="sm" className="mt-3"
                                onClick={() => attachmentInputRef.current?.click()}>
                                + Attach file
                              </Button>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="overflow-y-auto">
                          <table className="w-full border-collapse">
                            <thead className="sticky top-0 z-10">
                              <tr className="bg-slate-50 border-y border-slate-200">
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400">Title / File name</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[90px]">Type</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[90px]">Size</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[140px]">Added</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[95px]">Children</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[260px]">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredCurrentAttachments.map(att => {
                                const fi       = fileInfoFromMime(att.mime_type, att.file_name)
                                const children = childCount(att.id)
                                const label    = displayName(att)
                                const isEditing = editingAttachmentId === att.id
                                return (
                                  <tr key={att.id} className="border-b border-slate-100 transition-colors group hover:bg-blue-50/50">
                                    <td className="px-4 py-3">
                                      {isEditing ? (
                                        <div className="flex flex-col gap-2">
                                          <input
                                            type="text"
                                            value={editingAttachmentName}
                                            onChange={e => setEditingAttachmentName(e.target.value)}
                                            onKeyDown={async e => {
                                              if (e.key === 'Enter') {
                                                e.preventDefault()
                                                setRenamingAttachmentId(att.id)
                                                const ok = await handleRenameAttachment(att, editingAttachmentName)
                                                setRenamingAttachmentId(null)
                                                if (ok) { setEditingAttachmentId(null); setEditingAttachmentName('') }
                                              }
                                              if (e.key === 'Escape') { setEditingAttachmentId(null); setEditingAttachmentName('') }
                                            }}
                                            className="w-full px-2 py-2 text-sm border border-blue-300 bg-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200"
                                            disabled={renamingAttachmentId === att.id}
                                            autoFocus
                                          />
                                          <div className="flex flex-wrap gap-2">
                                            <button
                                              onClick={async () => {
                                                setRenamingAttachmentId(att.id)
                                                const ok = await handleRenameAttachment(att, editingAttachmentName)
                                                setRenamingAttachmentId(null)
                                                if (ok) { setEditingAttachmentId(null); setEditingAttachmentName('') }
                                              }}
                                              disabled={renamingAttachmentId === att.id}
                                              className="text-[10px] px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded font-medium transition disabled:opacity-60"
                                            >
                                              {renamingAttachmentId === att.id ? '…' : 'Save'}
                                            </button>
                                            <button
                                              onClick={() => { setEditingAttachmentId(null); setEditingAttachmentName('') }}
                                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 transition"
                                            ><X size={13} /></button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-2.5">
                                          <Paperclip size={16} className="flex-shrink-0 text-blue-600" />
                                          <button
                                            onClick={() => handleDrillDown(att)}
                                            className="text-sm font-semibold truncate max-w-[240px] text-left transition text-slate-800 hover:text-blue-600 hover:underline cursor-pointer"
                                            title={`Click to explore ${label}`}
                                          >
                                            {label}
                                          </button>
                                          <span className="flex-shrink-0 text-[9px] font-bold text-slate-300 group-hover:text-blue-400 transition">›</span>
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${fi.badgeCls}`}>
                                        {fi.label}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500">{formatBytes(att.file_size_bytes)}</td>
                                    <td className="px-4 py-3 text-xs text-slate-500">
                                      {new Date(att.created_at).toLocaleString('en-PH', {
                                        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                      })}
                                    </td>
                                    <td className="px-4 py-3">
                                      {children > 0 ? (
                                        <button onClick={() => handleDrillDown(att)}
                                          className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full transition">
                                          <Paperclip size={14} /> {children}
                                        </button>
                                      ) : (
                                        <span className="text-xs text-slate-300">—</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={() => setViewerFile({ url: att.gdrive_url, name: label, sourceDocumentId: att.master_document_id })}
                                          className="inline-flex items-center justify-center px-1.5 py-1.5 text-blue-600 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 hover:border-blue-300 transition"
                                          title="View file">
                                          <Eye size={14} strokeWidth={2} />
                                        </button>
                                        <button type="button"
                                          onClick={() => handleDownloadFile(att.gdrive_url, getSuggestedFileName(label, att.gdrive_url), `attachment-${att.id}`, att.master_document_id)}
                                          disabled={downloadingKey === `attachment-${att.id}`}
                                          className="inline-flex items-center justify-center px-1.5 py-1.5 text-slate-600 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 hover:border-slate-300 transition disabled:opacity-60"
                                          title="Download file">
                                          <Download size={14} />
                                        </button>
                                        <button type="button"
                                          onClick={() => handlePrintFile(att.gdrive_url, label, att.master_document_id)}
                                          className="inline-flex items-center justify-center px-1.5 py-1.5 text-slate-600 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 hover:border-slate-300 transition"
                                          title="Print file">
                                          <Printer size={14} />
                                        </button>
                                        <button onClick={() => handleDrillDown(att)}
                                          className="inline-flex items-center justify-center px-1.5 py-1.5 text-violet-600 bg-violet-50 border border-violet-200 rounded-md hover:bg-violet-100 hover:border-violet-300 transition"
                                          title="Open & explore nested attachments">
                                          <FolderOpen size={14} />
                                        </button>
                                        {canModifyDocuments && (
                                          <>
                                            <button
                                              onClick={() => { setEditingAttachmentId(att.id); setEditingAttachmentName(att.title || att.file_name || '') }}
                                              className="inline-flex items-center justify-center px-1.5 py-1.5 text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 hover:border-emerald-300 transition"
                                              title="Rename attachment">
                                              <Pencil size={14} />
                                            </button>
                                            <button onClick={() => deleteAttDisc.open(att)}
                                              className="inline-flex items-center justify-center px-1.5 py-1.5 text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 transition"
                                              title="Delete attachment">
                                              <Trash2 size={14} />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AddDocumentModal open={uploadModal.isOpen} onClose={uploadModal.close} onAdd={handleAdd} />
      <EditModal doc={selection} open={editModal.isOpen} onClose={editModal.close} onSave={handleSave} />

      {viewerFile && (
        <InlineFileViewerModal
          fileUrl={viewerFile.url}
          fileName={viewerFile.name}
          open={!!viewerFile}
          onDownload={(fileUrl, fileName) =>
            handleDownloadFile(fileUrl, getSuggestedFileName(fileName, fileUrl), `viewer-${viewerFile.sourceDocumentId ?? fileName}`, viewerFile.sourceDocumentId)
          }
          onPrint={(fileUrl, fileName) => handlePrintFile(fileUrl, fileName, viewerFile.sourceDocumentId)}
          onClose={() => setViewerFile(null)}
        />
      )}

      {selection && (
        <ForwardDocumentModal
          open={forwardModalOpen}
          onClose={() => setForwardModalOpen(false)}
          document={{
            id:            selection.id,
            title:         selection.title,
            type:          'Master Document',
            documentType:  'master_document',
            gdriveFileId:  (selection as any).gdrive_file_id  ?? '',
            gdriveUrl:     (selection as any).gdrive_url       ?? selection.fileUrl ?? '',
            poolAccountId: (selection as any).pool_account_id  ?? '',
            fileName:      (selection as any).file_name        ?? undefined,
            fileSizeBytes: (selection as any).file_size_bytes  ?? undefined,
            mimeType:      (selection as any).mime_type        ?? undefined,
          }}
          attachmentsMap={attachmentsMap as any}
          onForwarded={() => setForwardModalOpen(false)}
          senderRole={user?.role as AdminRole}
        />
      )}

      {selection && (
        <ApprovalWorkflowModal
          open={approvalModal.isOpen}
          onClose={approvalModal.close}
          documentId={selection.id}
          documentType="master"
          documentTitle={selection.title}
          approval={activeApproval}
          onDone={() => {
            setDocuments(prev => prev.map(d => d.id === selection.id
              ? { ...d, approval: { ...d.approval!, status: 'approved' } as DocumentApproval }
              : d
            ))
          }}
        />
      )}

      <ConfirmDialog
        open={archiveDisc.isOpen}
        title="Archive Document"
        message={`Archive "${archiveDisc.payload}"? This will move the uploaded file to an archive folder in the connected Google Drive account, and remove it from the active document list. You can restore archived documents from the Archive section if needed.`}
        confirmLabel="Archive" variant="danger"
        isLoading={isArchiving}
        onConfirm={handleArchiveDoc}
        onCancel={archiveDisc.close}
      />

      // Update both ConfirmDialogs at the bottom
        <ConfirmDialog
          open={deleteAttDisc.isOpen}
          title="Delete Attachment"
          message={`Delete "${deleteAttDisc.payload ? displayName(deleteAttDisc.payload) : ''}" permanently? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          isLoading={isDeleting}        // ← add
          onConfirm={handleDeleteAttachment}
          onCancel={deleteAttDisc.close}
        />

        <ConfirmDialog
          open={deleteDisc.isOpen}
          title="Delete Document"
          message={`Delete "${deleteDisc.payload}" permanently? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          isLoading={isDeleting}        // ← add
          onConfirm={handleDeleteDoc}
          onCancel={deleteDisc.close}
        />
    </>
  )
}