'use client'
// app/admin/master/page.tsx  — v2
// Master Documents Management

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { PageHeader }       from '@/components/ui/PageHeader'
import { Badge }            from '@/components/ui/Badge'
import { Button }           from '@/components/ui/Button'
import { SearchInput }      from '@/components/ui/SearchInput'
import { ConfirmDialog }    from '@/components/ui/ConfirmDialog'
import { EmptyState }       from '@/components/ui/EmptyState'
import { ToolbarSelect }    from '@/components/ui/Toolbar'
import { Modal }            from '@/components/ui/Modal'
import { AddDocumentModal } from '@/components/modals/AddDocumentModal'
import { ApprovalWorkflowModal }  from '@/components/modals/ApprovalWorkflowModal'
import { ForwardDocumentModal } from '@/components/modals/ForwardDocumentModal'
import { UploadGuard }      from '@/components/ui/UploadGuard'
import { useModal, useDisclosure } from '@/hooks'
import { useToast }         from '@/components/ui/Toast'
import { useAuth }          from '@/lib/auth'
import { levelBadgeClass }  from '@/lib/utils'
import { supabase }         from '@/lib/supabase'
import { useRealtimeMasterDocs } from './useRealtimeMasterDocs'
import { FileText, Paperclip, Printer } from 'lucide-react'
import {
  getMasterDocuments, addMasterDocument, updateMasterDocument,
  archiveMasterDocument, deleteMasterDocument, addArchivedDoc, getArchivedDocs,
} from '@/lib/data'
import {
  getApproval, getPendingApprovals, 
  createApproval, reviewByDPDAorDPDO, finalApproveByPD,
  type DocumentApproval, type DocType,
} from '@/lib/rbac'
import { logDeleteDocument, logEditDocument, logRenameAttachment, logViewDocument } from '@/lib/adminLogger'
import {
  hasFullDocumentAccess, ROLE_META,
} from '@/lib/permissions'
import type { MasterDocument, DocLevel } from '@/types'
import type { AdminRole } from '@/lib/auth'


type DocWithUrl = MasterDocument & { fileUrl?: string }
type DocEnriched = DocWithUrl & {
  approval?: DocumentApproval | null
  created_at?: string
  // FIX 1: Add children typing so flattenDocs doesn't error
  children?: DocEnriched[]
}

type AttachmentNavEntry =
  | { kind: 'document'; doc: DocEnriched }
  | { kind: 'attachment'; att: DocAttachment }

// ── Attachment types ─────────
export interface DocAttachment {
  id: string; document_id: string; parent_attachment_id: string | null
  file_name: string; file_url: string; file_size: string
  file_type: string; uploaded_at: string; uploaded_by: string; archived: boolean
}

function normaliseAttachment(row: any): DocAttachment {
  return {
    id: row.id, document_id: row.document_id,
    parent_attachment_id: row.parent_attachment_id ?? null,
    file_name: row.file_name, file_url: row.file_url, file_size: row.file_size,
    file_type: row.file_type, uploaded_at: row.uploaded_at,
    uploaded_by: row.uploaded_by, archived: row.archived === true,
  }
}

async function dbAddAttachment(att: Omit<DocAttachment, 'uploaded_at'>): Promise<DocAttachment | null> {
  const { data, error } = await supabase
    .from('master_document_attachments')
    .insert({ ...att, archived: false, uploaded_at: new Date().toISOString() })
    .select().single()
  if (error) { console.error('addAttachment error:', error.message); return null }
  return normaliseAttachment(data)
}

async function dbArchiveAttachment(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('master_document_attachments')
    .update({ archived: true }).eq('id', id)
    .select('id, archived').single()
  if (error) { console.error('archiveAttachment error:', error.message); return false }
  return data?.archived === true
}

async function dbRestoreAttachment(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('master_document_attachments')
    .update({ archived: false }).eq('id', id)
    .select('id, archived').single()
  if (error) { console.error('restoreAttachment error:', error.message); return false }
  return data?.archived === false
}

async function dbRenameAttachment(id: string, newName: string): Promise<boolean> {
  const { error } = await supabase
    .from('master_document_attachments')
    .update({ file_name: newName })
    .eq('id', id)
  if (error) { console.error('renameAttachment error:', error.message); return false }
  return true
}

function fileInfo(name: string) {
  if (name.match(/\.pdf$/i))
    return { icon: '📕', label: 'PDF',  badgeCls: 'bg-red-100 text-red-700' }
  if (name.match(/\.docx?$/i))
    return { icon: '📘', label: 'DOCX', badgeCls: 'bg-blue-100 text-blue-700' }
  if (name.match(/\.xlsx?$/i))
    return { icon: '📗', label: 'XLSX', badgeCls: 'bg-green-100 text-green-700' }
  if (name.match(/\.(jpg|jpeg|png|webp)$/i))
    return { icon: '🖼️', label: 'IMG',  badgeCls: 'bg-violet-100 text-violet-700' }
  return { icon: '📄', label: 'FILE', badgeCls: 'bg-slate-100 text-slate-600' }
}

function Breadcrumb({
  navStack,
  onNavigateTo,
}: {
  navStack: AttachmentNavEntry[]
  onNavigateTo: (index: number) => void
}) {
  if (navStack.length <= 1) return null

  return (
    <div className="flex items-center gap-0 flex-wrap mb-4 px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl">
      <span className="text-slate-400 mr-1 text-sm">🗂</span>
      {navStack.map((entry, i) => {
        const label = entry.kind === 'document' ? `${entry.doc.tag} – ${entry.doc.title}` : entry.att.file_name
        const isLast = i === navStack.length - 1
        const fi = entry.kind === 'attachment' ? fileInfo(entry.att.file_name) : null

        return (
          <span key={i} className="flex items-center">
            {i > 0 && (
              <span className="mx-1.5 text-slate-400 font-bold text-sm select-none">›</span>
            )}
            {isLast ? (
              <span
                className="flex items-center gap-1 text-[13px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg"
                title={label}
              >
                {fi && <Paperclip size={14} className="flex-shrink-0 text-blue-600" />}
                <span className="truncate max-w-[180px]">{label.length > 28 ? label.slice(0, 27) + '…' : label}</span>
              </span>
            ) : (
              <button
                onClick={() => onNavigateTo(i)}
                className="flex items-center gap-1 text-[13px] font-semibold text-slate-600 hover:text-blue-700 hover:bg-white border border-transparent hover:border-blue-200 px-2 py-1 rounded-lg transition-all"
                title={`Go back to ${label}`}
              >
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
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`)
  }

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
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.opacity = '0'

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
      finish(() => {
        cleanup()
        reject(new Error('Print timed out.'))
      })
    }, 15000)

    fetch(fileUrl)
      .then(response => {
        if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`)
        return response.blob()
      })
      .then(blob => {
        blobUrl = URL.createObjectURL(blob)
        iframe.src = blobUrl

        iframe.onload = () => {
          const target = iframe.contentWindow
          if (!target) {
            finish(() => {
              cleanup()
              reject(new Error('Unable to load printable content.'))
            })
            return
          }

          window.setTimeout(() => {
            finish(() => {
              try {
                target.focus()
                target.print()
                resolve()
              } catch (error) {
                reject(error instanceof Error ? error : new Error('Print failed.'))
              } finally {
                window.setTimeout(cleanup, 1200)
              }
            })
          }, 500)
        }

        iframe.onerror = () => {
          finish(() => {
            cleanup()
            reject(new Error('Could not load file for printing.'))
          })
        }

        document.body.appendChild(iframe)
      })
      .catch(error => {
        finish(() => {
          cleanup()
          reject(error instanceof Error ? error : new Error('Failed to prepare file for printing.'))
        })
      })
  })
}

// ── Inline File Viewer ─────────────────────────
function InlineFileViewerModal({ fileUrl, fileName, open, onClose, onDownload, onPrint }: {
  fileUrl: string; fileName: string; open: boolean; onClose: () => void
  onDownload?: (fileUrl: string, fileName: string) => Promise<void>
  onPrint?: (fileUrl: string, fileName: string) => Promise<void>
}) {
  const { toast } = useToast()
  const [isDownloading, setIsDownloading] = useState(false)
  const isPDF   = !!fileUrl.match(/\.pdf(\?|$)/i)
  const isImage = !!fileUrl.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)
  const fi      = fileInfo(fileName)

  async function handleDownload() {
    try {
      setIsDownloading(true)
      if (onDownload) {
        await onDownload(fileUrl, fileName)
      } else {
        const saved = await saveFileFromUrl(fileUrl, getSuggestedFileName(fileName, fileUrl))
        toast.success(saved ? `Downloaded "${fileName}" successfully.` : `Downloaded "${fileName}" successfully.`)
      }
    } catch (error) {
      console.error('download error:', error)
      toast.error('Could not download the file.')
    } finally {
      setIsDownloading(false)
    }
  }

  async function handlePrint() {
    try {
      setIsDownloading(true)
      if (onPrint) {
        await onPrint(fileUrl, fileName)
        return
      }

      await printFileFromUrl(fileUrl)
      toast.success('Opened print dialog.')
    } catch (error) {
      console.error('print error:', error)
      toast.error('Could not print the file.')
    } finally {
      setIsDownloading(false)
    }
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
            <button
              type="button"
              onClick={handleDownload}
              disabled={isDownloading}
              className="text-[11px] font-semibold px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isDownloading ? '⬇ Saving…' : '⬇ Download'}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={isDownloading}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Printer size={13} /> Print
            </button>
            <Button variant="outline" size="sm" onClick={onClose}>✕ Close</Button>
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
              <button
                type="button"
                onClick={handleDownload}
                disabled={isDownloading}
                className="inline-flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-blue-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isDownloading ? '⬇ Saving…' : '⬇ Download to view'}
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ── Edit Modal ─────────────────────────────────
function EditModal({ doc, open, onClose, onSave }: {
  doc: DocEnriched | null; open: boolean; onClose: () => void
  onSave: (updated: DocWithUrl) => void
}) {
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [level, setLevel] = useState<DocLevel>('REGIONAL')
  const [date,  setDate]  = useState('')
  const [type,  setType]  = useState('PDF')

  // FIX 2: useEffect instead of useMemo for side-effects (setting state)
  useEffect(() => {
    if (doc) {
      setTitle(doc.title)
      setLevel(doc.level)
      setDate(doc.date)
      setType(doc.type)
    }
  }, [doc])

  function submit() {
    if (!title.trim()) { toast.error('Title is required.'); return }
    if (!doc) return
    onSave({
      ...doc,
      title: title.trim(),
      level,
      date,
      type,
    })
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
            <label className="block text-[11px] font-semibold uppercase tracking-widests text-slate-500 mb-1.5">File Type</label>
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

// ── Flatten doc tree ───────────────────────────
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

  const [documents,      setDocuments]      = useState<DocEnriched[]>([])
  const [query,          setQuery]          = useState('')
  const [levelFilter,    setLevel]          = useState<DocLevel | 'ALL'>('ALL')
  const [loading,        setLoading]        = useState(true)
  const [attachmentsMap, setAttachmentsMap] = useState<Map<string, DocAttachment[]>>(new Map())
  const [selection,      setSelection]      = useState<DocEnriched | null>(null)
  const [uploadingId,    setUploadingId]    = useState<string | null>(null)
  const [viewerFile,     setViewerFile]     = useState<{ url: string; name: string; sourceDocumentId?: string } | null>(null)
  const [activeApproval, setActiveApproval] = useState<DocumentApproval | null>(null)
  const [pendingApprovals, setPending]      = useState<DocumentApproval[]>([])
  const [forwardModalOpen, setForwardModalOpen] = useState(false)
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [showArchivedAttachments, setShowArchivedAttachments] = useState(false)
  const [editingAttachmentId, setEditingAttachmentId] = useState<string | null>(null)
  const [editingAttachmentName, setEditingAttachmentName] = useState('')
  const [renamingAttachmentId, setRenamingAttachmentId] = useState<string | null>(null)

  const archiveAttDisc = useDisclosure<DocAttachment>()
  const uploadModal    = useModal()
  const editModal      = useModal()
  const archiveDisc    = useDisclosure<string>()
  const deleteDisc     = useDisclosure<string>()
  const approvalModal  = useModal()
  const [attachmentNavStack, setAttachmentNavStack] = useState<AttachmentNavEntry[]>([])

  // Role flags
  const isP1            = user?.role === 'P1'
  const isPrivileged    = user ? hasFullDocumentAccess(user.role) : false
  const canModifyDocuments = user ? !['DPDA', 'DPDO'].includes(user.role) : false

  useRealtimeMasterDocs({
    setDocuments,
    setAttachmentsMap,
    user,
    isPrivileged,
    isP1,
  })

  const handleDownloadFile = useCallback(async (
    fileUrl: string,
    suggestedName: string,
    downloadKey: string,
    sourceDocumentId?: string,
  ) => {
    try {
      setDownloadingKey(downloadKey)
      const saved = await saveFileFromUrl(fileUrl, suggestedName)
      toast.success(saved ? `Downloaded "${suggestedName}" successfully.` : `Downloaded "${suggestedName}" successfully.`)
    } catch (error) {
      console.error('download error:', error)
      toast.error('Could not download the file.')
    } finally {
      setDownloadingKey(current => current === downloadKey ? null : current)
    }
  }, [toast])

  const handlePrintFile = useCallback(async (
    fileUrl: string,
    fileName: string,
    sourceDocumentId?: string,
  ) => {
    try {
      await printFileFromUrl(fileUrl)
      toast.success(`Opened print preview for "${fileName}".`)
    } catch (error) {
      console.error('print error:', error)
      toast.error('Could not print the file.')
    }
  }, [toast])

  useEffect(() => {
    async function loadAll() {
      try {
        const [docs, archived] = await Promise.all([getMasterDocuments(), getArchivedDocs()])
        const archivedIds = new Set(
          (archived ?? [])
            .map((a: any) => String(a.id ?? ''))
            .filter((id: string) => id.startsWith('arc-md-'))
            .map((id: string) => id.replace('arc-md-', ''))
        )
        const activeDocs = docs.filter((d: DocWithUrl) => !archivedIds.has(d.id))

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
            .in('document_id', docs.map(d => d.id))
            .order('uploaded_at', { ascending: true })

          const map = new Map<string, DocAttachment[]>()
          for (const row of (allAtts ?? [])) {
            const att = normaliseAttachment(row)
            const key = att.parent_attachment_id ?? att.document_id
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
  }, [selection?.id])

  async function handleAdd(newDoc: DocWithUrl) {
    await addMasterDocument(newDoc)
    await createApproval(newDoc.id, 'master', newDoc.title)
    const enriched: DocEnriched = {
      ...newDoc,
      approval: null,
    }
    setDocuments(prev => {
      if (prev.some(d => d.id === enriched.id)) {
        return prev.map(d => d.id === enriched.id ? { ...d, ...enriched } : d)
      }
      return [...prev, enriched]
    })
    setAttachmentsMap(prev => { const next = new Map(prev); next.set(newDoc.id, []); return next })
    setSelection(enriched)
  }

  async function handleSave(updated: DocWithUrl) {
    await updateMasterDocument(updated)
    await logEditDocument(updated.title)
    setDocuments(prev => prev.map(d => d.id === updated.id
      ? { ...d, ...updated }
      : d
    ))
    if (selection?.id === updated.id) {
      setSelection(prev => prev ? { ...prev, ...updated } : prev)
    }
    toast.success('Document updated.')
    editModal.close()
  }

  async function handleArchiveDoc() {
    if (!selection) return
    const doc  = selection
    const date = new Date().toISOString().split('T')[0]
    await addArchivedDoc({ id: `arc-md-${doc.id}`, title: doc.title, type: 'Master Document', archivedDate: date, archivedBy: user?.role ?? 'P1' })
    await archiveMasterDocument(doc.id)
    setDocuments(prev => prev.filter(d => d.id !== doc.id))
    setSelection(null)
    toast.success('Document archived.')
    archiveDisc.close()
  }

  async function handleDeleteDoc() {
    if (!selection) return
    const doc = selection
    await deleteMasterDocument(doc.id)
    await logDeleteDocument(doc.title, 'master document')
    setDocuments(prev => prev.filter(d => d.id !== doc.id))
    setSelection(null)
    toast.success('Document deleted permanently.')
    deleteDisc.close()
  }

  async function handleUpload(parentDocId: string, parentAttId: string | null, files: FileList) {
    setUploadingId(parentAttId ?? parentDocId)
    let count = 0
    for (const file of Array.from(files)) {
      const folder = parentAttId ? `master-docs/attachments/${parentDocId}/nested/${parentAttId}` : `master-docs/attachments/${parentDocId}`
      const fileName = `${folder}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
      const { data: storageData, error: storageError } = await supabase.storage.from('documents').upload(fileName, file, { cacheControl: '3600', upsert: false })
      if (storageError) { toast.error(`Failed to upload "${file.name}".`); continue }
      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storageData.path)
      const ext = file.name.split('.').pop()?.toUpperCase() ?? 'FILE'
      const newAtt = await dbAddAttachment({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        document_id: parentDocId, parent_attachment_id: parentAttId,
        file_name: file.name, file_url: urlData.publicUrl,
        file_size: file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`,
        file_type: ext, uploaded_by: user?.role ?? 'P1', archived: false,
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

  async function handleArchiveAttachment() {
    const att = archiveAttDisc.payload
    if (!att) return
    const ok = await dbArchiveAttachment(att.id)
    if (!ok) { toast.error('Could not archive attachment.'); return }
    const mapKey = att.parent_attachment_id ?? att.document_id
    setAttachmentsMap(prev => {
      const next = new Map(prev)
      next.set(mapKey, (next.get(mapKey) ?? []).map(a => a.id === att.id ? { ...a, archived: true } : a))
      return next
    })
    setAttachmentNavStack(prev => {
      const idx = prev.findIndex(entry => entry.kind === 'attachment' && entry.att.id === att.id)
      return idx === -1 ? prev : prev.slice(0, idx)
    })
    toast.success(`"${att.file_name}" archived.`)
    archiveAttDisc.close()
  }

  async function handleRestoreAttachment(att: DocAttachment) {
    const ok = await dbRestoreAttachment(att.id)
    if (!ok) { toast.error('Could not restore attachment.'); return }
    const mapKey = att.parent_attachment_id ?? att.document_id
    setAttachmentsMap(prev => {
      const next = new Map(prev)
      next.set(mapKey, (next.get(mapKey) ?? []).map(a => a.id === att.id ? { ...a, archived: false } : a))
      return next
    })
    toast.success(`"${att.file_name}" restored.`)
  }

  async function handleRenameAttachment(att: DocAttachment, newName: string): Promise<boolean> {
    const trimmed = newName.trim()
    if (!trimmed) { toast.error('File name cannot be empty.'); return false }
    if (trimmed === att.file_name) return true

    const ok = await dbRenameAttachment(att.id, trimmed)
    if (!ok) { toast.error('Failed to rename attachment.'); return false }

    const mapKey = att.parent_attachment_id ?? att.document_id
    setAttachmentsMap(prev => {
      const next = new Map(prev)
      const list = next.get(mapKey) ?? []
      next.set(mapKey, list.map(a => a.id === att.id ? { ...a, file_name: trimmed } : a))
      return next
    })
    await logRenameAttachment(att.file_name, trimmed)
    toast.success('Attachment renamed.')
    return true
  }

  const countActiveAttachments = useCallback((parentId: string): number => {
    const children = attachmentsMap.get(parentId) ?? []
    return children.reduce((total, att) => {
      if (att.archived) return total
      return total + 1 + countActiveAttachments(att.id)
    }, 0)
  }, [attachmentsMap])

  const childCount = useCallback((attId: string): number => {
    const children = attachmentsMap.get(attId) ?? []
    return children.reduce((total, att) => {
      if (att.archived) return total
      return total + 1 + childCount(att.id)
    }, 0)
  }, [attachmentsMap])

  const allFlat  = useMemo(() => flattenDocs(documents), [documents])
  const filtered = useMemo(() => allFlat.filter(({ doc }) => {
    const q = query.trim().toLowerCase()
    const matchesDocument = !q || doc.title.toLowerCase().includes(q)

    const matchesAttachment = q ? (() => {
      const searchNested = (parentId: string): boolean => {
        const items = attachmentsMap.get(parentId) ?? []
        return items.some(att =>
          att.file_name.toLowerCase().includes(q) || searchNested(att.id)
        )
      }
      return searchNested(doc.id)
    })() : false

    return (matchesDocument || matchesAttachment) &&
           (levelFilter === 'ALL' || doc.level === levelFilter)
  }), [allFlat, query, levelFilter, attachmentsMap])

  const currentAttachmentEntry = attachmentNavStack.length > 0
    ? attachmentNavStack[attachmentNavStack.length - 1]
    : null

  const currentAttachments = useMemo((): DocAttachment[] => {
    if (!selection) return []

    if (currentAttachmentEntry?.kind === 'attachment') {
      return attachmentsMap.get(currentAttachmentEntry.att.id) ?? []
    }

    return (attachmentsMap.get(selection.id) ?? []).filter(a => !a.parent_attachment_id)
  }, [selection, attachmentsMap, currentAttachmentEntry])

  const filteredCurrentAttachments = useMemo((): DocAttachment[] => {
    const q = query.trim().toLowerCase()
    if (!q) return currentAttachments

    const searchNested = (parentId: string): boolean => {
      const items = attachmentsMap.get(parentId) ?? []
      return items.some(att => att.file_name.toLowerCase().includes(q) || searchNested(att.id))
    }

    return currentAttachments.filter(att =>
      att.file_name.toLowerCase().includes(q) || searchNested(att.id)
    )
  }, [currentAttachments, query, attachmentsMap])

  const currentParentAttachment = currentAttachmentEntry?.kind === 'attachment'
    ? currentAttachmentEntry.att
    : null

  const previousAttachmentEntry = attachmentNavStack.length > 1
    ? attachmentNavStack[attachmentNavStack.length - 2]
    : null

  const backLabel = !previousAttachmentEntry
    ? 'Document'
    : previousAttachmentEntry.kind === 'document'
      ? previousAttachmentEntry.doc.title
      : previousAttachmentEntry.att.file_name

  function handleSelectDocument(doc: DocEnriched) {
    setSelection(doc)
    setAttachmentNavStack([{ kind: 'document', doc }])
    setShowArchivedAttachments(false)
  }

  function handleDrillDown(att: DocAttachment) {
    setAttachmentNavStack(prev => [...prev, { kind: 'attachment', att }])
    setShowArchivedAttachments(false)
  }

  function handleNavigateTo(index: number) {
    setAttachmentNavStack(prev => prev.slice(0, index + 1))
    setShowArchivedAttachments(false)
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

            <UploadGuard showDisabled>
              <Button variant="primary" size="sm" className="ml-auto" onClick={uploadModal.open}>
                + Upload
              </Button>
            </UploadGuard>
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
                  filtered.map(({ doc, depth }) => {
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
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
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
                    <EmptyState
                      icon="📄"
                      title="Select a document"
                      description="Click any document from the list to view its details."
                    />
                  </div>
                ) : (
                  <div className="animate-fade-up space-y-5">

                  {/* Back Button */}
                  {attachmentNavStack.length > 1 && (
                    <button
                      onClick={() => handleNavigateTo(attachmentNavStack.length - 2)}
                      className="inline-flex items-center gap-2 mb-4 px-4 py-2 bg-white border-2 border-slate-300 hover:border-blue-500 hover:bg-blue-50 text-slate-700 hover:text-blue-700 rounded-xl font-semibold text-sm transition-all shadow-sm hover:shadow-md self-start"
                    >
                      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                      </svg>
                      <span>
                        Back to{' '}
                        <span className="font-bold">{backLabel}</span>
                      </span>
                    </button>
                  )}

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
                              year: 'numeric', 
                              month: 'short', 
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        )}
                        <span className="bg-slate-100 px-2 py-0.5 rounded-full">{selection.type} · {selection.size}</span>
                      </div>
                    </div>

                    <div className="flex gap-2 flex-shrink-0 flex-wrap">
                      {canModifyDocuments && (
                        <>
                          <Button variant="primary" size="sm" onClick={() => setForwardModalOpen(true)}>🔀 Forward</Button>
                          <Button variant="outline" size="sm" onClick={editModal.open}>✏️ Edit</Button>
                          <Button variant="danger" size="sm" onClick={() => archiveDisc.open(selection.title)}>🗄️ Archive</Button>
                          <Button variant="danger" size="sm" onClick={() => deleteDisc.open(selection.title)}>🗑️ Delete</Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Primary file */}
                  {selection.fileUrl ? (
                    <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                      <span className="text-lg flex-shrink-0">
                        {selection.type === 'PDF' ? '📕' : selection.type === 'DOCX' ? '📘' : selection.type === 'XLSX' ? '📗' : '🖼️'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-blue-800 truncate">Primary file</p>
                        <p className="text-xs text-blue-600 truncate">{selection.title}.{selection.type.toLowerCase()}</p>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleDownloadFile(selection.fileUrl!, getSuggestedFileName(selection.title, selection.fileUrl!), `document-${selection.id}`, selection.id)}
                          disabled={downloadingKey === `document-${selection.id}`}
                          className="text-xs px-2.5 py-1 bg-white border border-blue-200 text-blue-700 rounded-md font-medium hover:bg-blue-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {downloadingKey === `document-${selection.id}` ? '⬇ Saving…' : '⬇ Download'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePrintFile(selection.fileUrl!, selection.title, selection.id)}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-white border border-blue-200 text-blue-700 rounded-md font-medium hover:bg-blue-100 transition"
                        >
                          <Printer size={13} /> Print
                        </button>
                        <button
                          onClick={() => {
                            setViewerFile({ url: selection.fileUrl!, name: selection.title, sourceDocumentId: selection.id })
                            if (user?.role) {
                              logViewDocument(selection.title).catch(() => {})
                            }
                          }}
                          className="text-xs px-2.5 py-1 bg-white border border-blue-200 text-blue-700 rounded-md font-medium hover:bg-blue-100 transition"
                        >
                          👁 View
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* Attachments */}
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Attachments</span>
                        <div className="flex items-center rounded-lg border border-slate-300 overflow-hidden bg-white shadow-sm">
                          <button
                            onClick={() => setShowArchivedAttachments(false)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all ${
                              !showArchivedAttachments
                                ? 'bg-blue-600 text-white shadow-inner'
                                : 'bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                            }`}
                          >
                            <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${
                              !showArchivedAttachments ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-600'
                            }`}>
                              {currentAttachments.filter(a => !a.archived).length}
                            </span>
                            Active
                          </button>
                          <div className="w-px h-full bg-slate-300" />
                          <button
                            onClick={() => setShowArchivedAttachments(true)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all ${
                              showArchivedAttachments
                                ? 'bg-amber-500 text-white shadow-inner'
                                : 'bg-white text-slate-600 hover:bg-amber-50 hover:text-amber-700'
                            }`}
                          >
                            <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${
                              showArchivedAttachments ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-600'
                            }`}>
                              {currentAttachments.filter(a => a.archived).length}
                            </span>
                            Archived
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {uploadingId && (
                          <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
                            <span className="w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin block" />
                            Uploading…
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
                        {!showArchivedAttachments && (
                          <Button variant="primary" size="sm" disabled={!!uploadingId}
                            onClick={() => attachmentInputRef.current?.click()}>
                            + Attach file
                          </Button>
                        )}
                      </div>
                    </div>

                    {attachmentNavStack.length > 1 && (
                      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/70">
                        <div className="flex items-center gap-1 flex-wrap">
                          {attachmentNavStack.map((entry, i) => {
                            const isLast = i === attachmentNavStack.length - 1
                            const label = entry.kind === 'document' ? entry.doc.title : entry.att.file_name
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

                    {(() => {
                      const activeAttachments = filteredCurrentAttachments.filter(a => !a.archived)
                      const archivedAttachments = filteredCurrentAttachments.filter(a => a.archived)
                      const displayed = showArchivedAttachments ? archivedAttachments : activeAttachments

                      if (displayed.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center py-10 text-center">
                            <FileText size={28} className="text-slate-300 mb-2" />
                            <p className="text-sm font-semibold text-slate-500">
                              {showArchivedAttachments ? 'No archived attachments' : 'No attachments yet'}
                            </p>
                            {!showArchivedAttachments && (
                              <>
                                <p className="text-xs text-slate-400 mt-1">Click + Attach file to upload {currentParentAttachment ? 'nested files under this attachment' : 'supporting documents'}.</p>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="mt-3"
                                  onClick={() => attachmentInputRef.current?.click()}
                                >
                                  + Attach file
                                </Button>
                              </>
                            )}
                          </div>
                        )
                      }

                      return (
                        <div className="overflow-y-auto">
                          <table className="w-full border-collapse">
                            <thead className="sticky top-0 z-10">
                              <tr className="bg-slate-50 border-y border-slate-200">
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400">File name</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[90px]">Type</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[90px]">Size</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[140px]">Uploaded</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[90px]">By</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[95px]">Children</th>
                                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[260px]">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {displayed.map(att => {
                                const fi = fileInfo(att.file_name)
                                const children = childCount(att.id)
                                const isEditing = editingAttachmentId === att.id

                                return (
                                  <tr
                                    key={att.id}
                                    className={`border-b border-slate-100 transition-colors group ${
                                      att.archived ? 'bg-amber-50/40 hover:bg-amber-50' : 'hover:bg-blue-50/50'
                                    }`}
                                  >
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
                                              className="text-[10px] px-2 py-1 bg-slate-100 text-slate-600 rounded font-medium transition"
                                            >
                                              ✕
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-2.5">
                                          <Paperclip size={16} className="flex-shrink-0 text-blue-600" />
                                          <button
                                            disabled={att.archived}
                                            onClick={() => !att.archived && handleDrillDown(att)}
                                            className={`text-sm font-semibold truncate max-w-[240px] text-left transition ${
                                              att.archived
                                                ? 'text-slate-400 line-through cursor-default'
                                                : 'text-slate-800 hover:text-blue-600 hover:underline cursor-pointer'
                                            }`}
                                            title={att.archived ? att.file_name : `Click to explore ${att.file_name}`}
                                          >
                                            {att.file_name}
                                          </button>
                                          {!att.archived && (
                                            <span className="flex-shrink-0 text-[9px] font-bold text-slate-300 group-hover:text-blue-400 transition">›</span>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${fi.badgeCls}`}>
                                        {fi.label}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500">{att.file_size}</td>
                                    <td className="px-4 py-3 text-xs text-slate-500">
                                      {new Date(att.uploaded_at).toLocaleString('en-PH', { 
                                        year: 'numeric', 
                                        month: 'short', 
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                      })}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500">{att.uploaded_by}</td>
                                    <td className="px-4 py-3">
                                      {!att.archived && children > 0 ? (
                                        <button
                                          onClick={() => handleDrillDown(att)}
                                          className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full transition"
                                        >
                                          <Paperclip size={14} /> {children}
                                        </button>
                                      ) : (
                                        <span className="text-xs text-slate-300">—</span>
                                      )}
                                    </td>
                                    {/* FIX 3: Replace broken object literal with valid JSX */}
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {!att.archived ? (
                                          <>
                                            <button
                                              onClick={() => {
                                                setViewerFile({ url: att.file_url, name: att.file_name, sourceDocumentId: att.document_id })
                                                if (user?.role) {
                                                  logViewDocument(att.file_name).catch(() => {})
                                                }
                                              }}
                                              className="text-[10px] font-semibold px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition"
                                            >
                                              👁 View
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleDownloadFile(att.file_url, getSuggestedFileName(att.file_name, att.file_url), `attachment-${att.id}`, att.document_id)}
                                              disabled={downloadingKey === `attachment-${att.id}`}
                                              className="text-[10px] font-semibold px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 transition disabled:opacity-60 disabled:cursor-not-allowed"
                                            >
                                              {downloadingKey === `attachment-${att.id}` ? '…' : '⬇'}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handlePrintFile(att.file_url, att.file_name, att.document_id)}
                                              className="text-[10px] font-semibold px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 transition"
                                              title="Print"
                                            >
                                              🖨️
                                            </button>
                                            <button
                                              onClick={() => handleDrillDown(att)}
                                              className="text-[10px] font-semibold px-2 py-1 bg-violet-50 text-violet-700 border border-violet-200 rounded hover:bg-violet-100 transition"
                                              title="Open nested attachments"
                                            >
                                              📂 Open
                                            </button>
                                            {canModifyDocuments && (
                                              <>
                                                <button
                                                  onClick={() => { setEditingAttachmentId(att.id); setEditingAttachmentName(att.file_name) }}
                                                  className="text-[10px] font-semibold px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 transition"
                                                >
                                                  ✏️
                                                </button>
                                                <button
                                                  onClick={() => archiveAttDisc.open(att)}
                                                  className="text-[10px] font-semibold px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 transition"
                                                >
                                                  🗄️
                                                </button>
                                              </>
                                            )}
                                          </>
                                        ) : (
                                          canModifyDocuments ? (
                                            <button
                                              onClick={() => handleRestoreAttachment(att)}
                                              className="text-[10px] font-semibold px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 transition"
                                            >
                                              ↩ Restore
                                            </button>
                                          ) : (
                                            <span className="text-xs text-slate-300">—</span>
                                          )
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}
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
            handleDownloadFile(
              fileUrl,
              getSuggestedFileName(fileName, fileUrl),
              `viewer-${viewerFile.sourceDocumentId ?? fileName}`,
              viewerFile.sourceDocumentId,
            )
          }
          onPrint={(fileUrl, fileName) =>
            handlePrintFile(
              fileUrl,
              fileName,
              viewerFile.sourceDocumentId,
            )
          }
          onClose={() => setViewerFile(null)}
        />
      )}

      {selection && (
        <ForwardDocumentModal
          open={forwardModalOpen}
          onClose={() => setForwardModalOpen(false)}
          document={{
            id: selection.id,
            title: selection.title,
            type: 'Master Document',
            fileUrl: selection.fileUrl,
            documentType: 'master',
          }}
          documentData={selection}
          attachmentsMap={attachmentsMap}
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
            setDocuments(prev => prev.map(d => d.id === selection.id ? { ...d, approval: { ...d.approval!, status: 'approved' } as DocumentApproval } : d))
          }}
        />
      )}

      <ConfirmDialog
        open={archiveDisc.isOpen}
        title="Archive Document"
        message={`Archive "${archiveDisc.payload}"?`}
        confirmLabel="Archive" variant="danger"
        onConfirm={handleArchiveDoc}
        onCancel={archiveDisc.close}
      />

      <ConfirmDialog
        open={archiveAttDisc.isOpen}
        title="Archive Attachment"
        message={`Archive "${archiveAttDisc.payload?.file_name}"?`}
        confirmLabel="Archive" variant="primary"
        onConfirm={handleArchiveAttachment}
        onCancel={archiveAttDisc.close}
      />

      <ConfirmDialog
        open={deleteDisc.isOpen}
        title="Delete Document"
        message={`Delete "${deleteDisc.payload}" permanently? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteDoc}
        onCancel={deleteDisc.close}
      />
    </>
  )
}