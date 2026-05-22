'use client'
// app/admin/admin-orders/page.tsx
// FIX: loadAll now filters special orders by user.role (uploaded_by)
//      so each account only sees the orders they personally uploaded.
//      DPDA, DPDO, and admin are privileged roles that see all orders.

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { PageHeader }           from '@/components/ui/PageHeader'
import { Badge }                from '@/components/ui/Badge'
import { Button }               from '@/components/ui/Button'
import { SearchInput }          from '@/components/ui/SearchInput'
import { EmptyState }           from '@/components/ui/EmptyState'
import { ConfirmDialog }        from '@/components/ui/ConfirmDialog'
import { ToolbarSelect }        from '@/components/ui/Toolbar'
import { Modal }                from '@/components/ui/Modal'
import { AddSpecialOrderModal } from '@/components/modals/AddSpecialOrderModal'
import { ForwardDocumentModal } from '@/components/modals/ForwardDocumentModal'
import { useModal, useDisclosure } from '@/hooks'
import { useToast }             from '@/components/ui/Toast'
import { FileText, Paperclip } from 'lucide-react'
import {
  getSpecialOrders,
  addSpecialOrder,
  updateSpecialOrder,
  deleteSpecialOrder,
  archiveSpecialOrder,
  addArchivedDoc,
  getArchivedDocs,
} from '@/lib/data'
import { supabase }             from '@/lib/supabase'
import { statusBadgeClass }     from '@/lib/utils'
import { logAction, logDeleteDocument, logRenameAttachment, logViewDocument, logDownloadDocument } from '@/lib/adminLogger'
import { useAuth } from '@/lib/auth'
import type { AdminRole } from '@/lib/auth'
import { useRealtimeSpecialOrders } from '@/hooks/useRealtimeSpecialOrders'
import type { SpecialOrder }    from '@/types'

// ── Privileged roles that can see ALL orders regardless of uploader ──────────
// FIX: DPDA, DPDO, and admin see everything; all other roles see only their own.
const PRIVILEGED_ROLES = ['admin', 'DPDA', 'DPDO']
function canSeeAllDocuments(role: string): boolean {
  return PRIVILEGED_ROLES.includes(role)
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SOWithUrl = SpecialOrder & {
  fileUrl?:         string
  gdrive_file_id?:  string
  gdrive_url?:      string
  pool_account_id?: string
  download_url?:    string
  uploaded_by?:     string   // FIX: who uploaded this order
}

export interface SOAttachment {
  id: string
  special_order_id: string
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

type NavEntry =
  | { kind: 'order';      order: SOWithUrl }
  | { kind: 'attachment'; att: SOAttachment }

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function displayName(att: SOAttachment): string {
  return att.title || att.file_name || att.gdrive_file_id
}

// ── Supabase helpers ───────────────────────────────────────────────────────────

function normaliseAttachment(row: any): SOAttachment {
  return {
    id:               row.id,
    special_order_id: row.special_order_id,
    parent_id:        row.parent_id ?? null,
    depth:            row.depth ?? 0,
    title:            row.title ?? '',
    file_name:        row.file_name ?? null,
    file_size_bytes:  row.file_size_bytes ?? null,
    mime_type:        row.mime_type ?? null,
    gdrive_file_id:   row.gdrive_file_id,
    gdrive_url:       row.gdrive_url,
    pool_account_id:  row.pool_account_id,
    created_at:       row.created_at,
  }
}

async function dbAddAttachment(
  att: Omit<SOAttachment, 'id' | 'created_at'>
): Promise<SOAttachment | null> {
  const { data, error } = await supabase
    .from('special_order_attachments')
    .insert(att)
    .select()
    .single()
  if (error) { console.error('addAttachment error:', error.message); return null }
  return normaliseAttachment(data)
}

async function dbRenameAttachment(id: string, newTitle: string): Promise<boolean> {
  const { error } = await supabase
    .from('special_order_attachments')
    .update({ title: newTitle })
    .eq('id', id)
  if (error) { console.error('renameAttachment DB error:', error.message); return false }
  return true
}

async function dbDeleteAttachment(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('special_order_attachments')
    .delete()
    .eq('id', id)
  if (error) { console.error('deleteAttachment DB error:', error.message); return false }
  return true
}

// ── Drive pool upload helper ───────────────────────────────────────────────────

interface DriveAttachmentResult {
  gdriveFileId:  string
  gdrive_url:    string
  poolAccountId: string
  downloadUrl:   string
  fileSizeBytes: number
}

async function uploadAttachmentToDrive(
  file: File,
  uploadedBy: string,
  entityId: string,
  parentAttId: string | null
): Promise<DriveAttachmentResult | null> {
  const formData = new FormData()
  formData.append('file',        file)
  formData.append('category',    'special_orders')
  formData.append('uploadedBy',  uploadedBy)
  formData.append('entityType',  parentAttId ? 'special_order_attachment' : 'special_order')
  formData.append('entityId',    entityId)

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
    downloadUrl:   r.downloadUrl   ?? '',
    fileSizeBytes: file.size,
  }
}

// ── File-type helpers ──────────────────────────────────────────────────────────

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
  return   { icon: '📄', label: 'FILE', badgeCls: 'bg-slate-100 text-slate-600' }
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
    const handle   = await picker.showSaveFilePicker({ suggestedName })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return true
  }
  const objectUrl = URL.createObjectURL(blob)
  const anchor    = document.createElement('a')
  anchor.href     = objectUrl
  anchor.download = suggestedName
  anchor.rel      = 'noopener'
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
    let settled  = false
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
        blobUrl    = URL.createObjectURL(blob)
        iframe.src = blobUrl
        iframe.onload = () => {
          const target = iframe.contentWindow
          if (!target) {
            finish(() => { cleanup(); reject(new Error('Unable to load printable content.')) })
            return
          }
          window.setTimeout(() => {
            finish(() => {
              try { target.focus(); target.print(); resolve() }
              catch (e) { reject(e instanceof Error ? e : new Error('Print failed.')) }
              finally { window.setTimeout(cleanup, 1200) }
            })
          }, 500)
        }
        iframe.onerror = () =>
          finish(() => { cleanup(); reject(new Error('Could not load file for printing.')) })
        document.body.appendChild(iframe)
      })
      .catch(e =>
        finish(() => { cleanup(); reject(e instanceof Error ? e : new Error('Failed to prepare file for printing.')) })
      )
  })
}

// ── Inline File Viewer Modal ───────────────────────────────────────────────────

function InlineFileViewerModal({
  fileUrl, fileName, open, onClose,
}: { fileUrl: string; fileName: string; open: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const [isDownloading, setIsDownloading] = useState(false)
  const isPDF   = !!fileUrl.match(/\.pdf(\?|$)/i)
  const isImage = !!fileUrl.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)
  const fi      = fileInfoFromMime(null, fileName)

  async function handleDownload() {
    try {
      setIsDownloading(true)
      await saveFileFromUrl(fileUrl, getSuggestedFileName(fileName, fileUrl))
      toast.success(`Downloaded "${fileName}" successfully.`)
    } catch { toast.error('Could not download the file.') }
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
              className="text-[11px] font-semibold px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition flex items-center gap-1 disabled:opacity-60">
              {isDownloading ? '⬇ Saving…' : '⬇ Download'}
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

// ── Edit SO Modal ──────────────────────────────────────────────────────────────

function EditSpecialOrderModal({
  open, order, onClose, onSave,
}: {
  open: boolean
  order: SOWithUrl | null
  onClose: () => void
  onSave: (updated: SOWithUrl) => Promise<void>
}) {
  const [form, setForm] = useState({
    reference: '',
    subject: '',
    date: '',
    status: 'ACTIVE' as 'ACTIVE' | 'ARCHIVED',
  })

  useEffect(() => {
    if (!order || !open) return
    setForm({
      reference: order.reference,
      subject:   order.subject,
      date:      order.date,
      status:    order.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    })
  }, [order, open])

  if (!order) return null

  return (
    <Modal open={open} onClose={onClose} title="Edit Special Order" width="max-w-lg">
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">SO Reference</label>
            <input
              className="w-full px-3 py-2.5 border-[1.5px] border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition"
              value={form.reference}
              onChange={e => setForm(prev => ({ ...prev, reference: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Date</label>
            <input type="date"
              className="w-full px-3 py-2.5 border-[1.5px] border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition"
              value={form.date}
              onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))}
            />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Subject</label>
          <input
            className="w-full px-3 py-2.5 border-[1.5px] border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition"
            value={form.subject}
            onChange={e => setForm(prev => ({ ...prev, subject: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Status</label>
          <select
            className="w-full px-3 py-2.5 border-[1.5px] border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition"
            value={form.status}
            onChange={e => setForm(prev => ({ ...prev, status: e.target.value as 'ACTIVE' | 'ARCHIVED' }))}
          >
            <option value="ACTIVE">ACTIVE</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </div>
        <div className="flex justify-end gap-2.5 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onSave({
              ...order,
              reference: form.reference.trim(),
              subject:   form.subject.trim(),
              date:      form.date,
              status:    form.status,
            })}
            disabled={!form.reference.trim() || !form.subject.trim() || !form.date}
          >
            💾 Save Changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Breadcrumb ─────────────────────────────────────────────────────────────────

function Breadcrumb({
  navStack, onNavigateTo,
}: {
  navStack: NavEntry[]
  onNavigateTo: (index: number) => void
}) {
  if (navStack.length <= 1) return null
  return (
    <div className="flex items-center gap-0 flex-wrap mb-4 px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl">
      <span className="text-slate-400 mr-1 text-sm">🗂</span>
      {navStack.map((entry, i) => {
        const label = entry.kind === 'order'
          ? `${entry.order.reference} – ${entry.order.subject}`
          : displayName(entry.att)
        const isLast = i === navStack.length - 1
        const fi = entry.kind === 'attachment'
          ? fileInfoFromMime(entry.att.mime_type, entry.att.file_name)
          : null
        return (
          <span key={i} className="flex items-center">
            {i > 0 && <span className="mx-1.5 text-slate-400 font-bold text-sm select-none">›</span>}
            {isLast ? (
              <span className="flex items-center gap-1 text-[13px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg" title={label}>
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

// ── Attachments Table Panel ────────────────────────────────────────────────────

function AttachmentsTablePanel({
  navStack, currentEntry, attachments, allAttachments,
  onUpload, uploadingId, onForwardOrder, onArchiveOrder, onDeleteOrder,
  canEditOrder, onEditOrder, onViewFile, onDownloadFile, onPrintFile,
  onDeleteAttachment, onDrillDown, onNavigateTo, onRenameAttachment,
}: {
  navStack: NavEntry[]
  currentEntry: NavEntry
  attachments: SOAttachment[]
  allAttachments: Map<string, SOAttachment[]>
  onUpload: (parentOrderId: string, parentAttId: string | null, files: FileList) => void
  uploadingId: string | null
  onForwardOrder: () => void
  onArchiveOrder: () => void
  onDeleteOrder: () => void
  canEditOrder: boolean
  onEditOrder: () => void
  onViewFile: (fileUrl: string, fileName: string) => void
  onDownloadFile: (fileUrl: string, fileName: string) => void
  onPrintFile: (fileUrl: string, fileName: string, sourceDocumentId?: string) => void
  onDeleteAttachment: (att: SOAttachment) => void
  onDrillDown: (att: SOAttachment) => void
  onNavigateTo: (index: number) => void
  onRenameAttachment: (att: SOAttachment, newTitle: string) => Promise<boolean>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [renamingId,  setRenamingId]  = useState<string | null>(null)

  const isDrillDown  = currentEntry.kind === 'attachment'
  const currentOrder = currentEntry.kind === 'order' ? currentEntry.order : null
  const currentLabel = isDrillDown
    ? displayName((currentEntry as { kind: 'attachment'; att: SOAttachment }).att)
    : `${currentOrder!.reference} – ${currentOrder!.subject}`

  const rootOrderId = navStack[0].kind === 'order' ? navStack[0].order.id : ''
  const parentAttId = isDrillDown ? (currentEntry as { kind: 'attachment'; att: SOAttachment }).att.id : null

  function childCount(attId: string): number {
    return (allAttachments.get(attId) ?? []).length
  }

  const drillAtt = isDrillDown ? (currentEntry as { kind: 'attachment'; att: SOAttachment }).att : null
  const drillFi  = drillAtt ? fileInfoFromMime(drillAtt.mime_type, drillAtt.file_name) : null

  return (
    <div className="animate-fade-up h-full flex flex-col">

      <Breadcrumb navStack={navStack} onNavigateTo={onNavigateTo} />

      {/* Title + actions */}
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl flex-shrink-0">{isDrillDown ? (drillFi?.icon ?? '📄') : '📋'}</span>
            <h2 className="text-lg font-extrabold text-slate-800 leading-tight truncate">{currentLabel}</h2>
            {isDrillDown && (
              <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                Nested File
              </span>
            )}
          </div>
          {isDrillDown && drillAtt && (
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-medium">{drillFi?.label}</span>
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-medium">{formatBytes(drillAtt.file_size_bytes)}</span>
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
                📅 {new Date(drillAtt.created_at).toLocaleString('en-PH', {
                  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          )}
          {!isDrillDown && currentOrder && (
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {currentOrder.created_at && (
                <span className="text-xs text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full font-medium">
                  📅 {new Date(currentOrder.created_at).toLocaleString('en-PH', {
                    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              )}
              <Badge className={statusBadgeClass(currentOrder.status)}>{currentOrder.status}</Badge>
            </div>
          )}
        </div>

        {!isDrillDown && (
          <div className="flex gap-2 flex-shrink-0">
            {canEditOrder && <Button variant="primary" size="sm" onClick={onForwardOrder}>🔀 Forward</Button>}
            {canEditOrder && <Button variant="outline" size="sm" onClick={onEditOrder}>✏ Edit</Button>}
            {canEditOrder && <Button variant="danger"  size="sm" onClick={onArchiveOrder}>🗄️ Archive</Button>}
            {canEditOrder && <Button variant="danger"  size="sm" onClick={onDeleteOrder}>🗑️ Delete</Button>}
          </div>
        )}

        {isDrillDown && drillAtt && (
          <div className="flex gap-1.5 flex-shrink-0">
            <button onClick={() => onViewFile(drillAtt.gdrive_url, displayName(drillAtt))}
              className="text-xs px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg font-semibold hover:bg-blue-100 transition">
              👁 View File
            </button>
            <button type="button" onClick={() => onDownloadFile(drillAtt.gdrive_url, displayName(drillAtt))}
              className="text-xs px-2.5 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-semibold hover:bg-slate-200 transition">
              ⬇ Download
            </button>
            <button type="button" onClick={() => onPrintFile(drillAtt.gdrive_url, displayName(drillAtt), drillAtt.special_order_id)}
              className="text-xs px-2.5 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg font-semibold hover:bg-green-100 transition">
              🖨️ Print
            </button>
            <button onClick={() => canEditOrder && onDeleteAttachment(drillAtt)} disabled={!canEditOrder}
              className="text-xs px-2.5 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg font-semibold hover:bg-red-100 transition disabled:opacity-50">
              🗑️ Delete
            </button>
          </div>
        )}
      </div>

      {/* Primary file preview strip (root order only) */}
      {!isDrillDown && currentOrder?.fileUrl && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
          <span className="text-lg flex-shrink-0">📋</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-blue-800 truncate">Primary file</p>
            <p className="text-xs text-blue-600 truncate">{currentOrder.reference} – {currentOrder.subject}</p>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button type="button" onClick={() => onDownloadFile(currentOrder.fileUrl!, currentOrder.reference)}
              className="text-xs px-2.5 py-1 bg-white border border-blue-200 text-blue-700 rounded-md font-medium hover:bg-blue-100 transition">
              ⬇ Download
            </button>
            <button type="button" onClick={() => onPrintFile(currentOrder.fileUrl!, currentOrder.reference, currentOrder.id)}
              className="text-xs px-2.5 py-1 bg-white border border-blue-200 text-blue-700 rounded-md font-medium hover:bg-blue-100 transition">
              🖨️ Print
            </button>
            <button onClick={() => onViewFile(currentOrder.fileUrl!, currentOrder.reference)}
              className="text-xs px-2.5 py-1 bg-white border border-blue-200 text-blue-700 rounded-md font-medium hover:bg-blue-100 transition">
              👁 View
            </button>
          </div>
        </div>
      )}

      {/* Attachments card */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex-1 flex flex-col min-h-0">

        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
            Attachments · {attachments.length}
          </span>
          <div className="flex items-center gap-2">
            {uploadingId && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600 font-medium bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
                <span className="w-3 h-3 border border-blue-600 border-t-transparent rounded-full animate-spin block" />
                Uploading…
              </span>
            )}
            {canEditOrder && (
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={e => {
                  if (e.target.files && e.target.files.length > 0)
                    onUpload(rootOrderId, parentAttId, e.target.files)
                  e.target.value = ''
                }}
              />
            )}
            {canEditOrder && (
              <Button variant="primary" size="sm" disabled={!!uploadingId}
                onClick={() => fileInputRef.current?.click()}>
                + Attach file
              </Button>
            )}
          </div>
        </div>

        {/* Body */}
        {attachments.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-14 px-6">
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-2xl mb-3">📎</div>
            <p className="text-sm font-semibold text-slate-600 mb-1">
              {`No ${isDrillDown ? 'child ' : ''}attachments yet`}
            </p>
            <p className="text-xs text-slate-400 mb-4 max-w-xs">
              {canEditOrder ? 'Click + Attach file to upload supporting documents.' : 'View-only access — no attachments yet.'}
            </p>
            {canEditOrder && (
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                + Attach file
              </Button>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400">Title / File name</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[80px]">Type</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[90px]">Size</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[130px]">Added</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[90px]">Children</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[220px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {attachments.map(att => {
                  const fi       = fileInfoFromMime(att.mime_type, att.file_name)
                  const children = childCount(att.id)
                  const label    = displayName(att)
                  const isEditing = editingId === att.id
                  return (
                    <tr key={att.id} className="border-b border-slate-100 transition-colors group hover:bg-blue-50/50">
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editingName}
                              onChange={e => setEditingName(e.target.value)}
                              onKeyDown={async e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  setRenamingId(att.id)
                                  const ok = await onRenameAttachment(att, editingName)
                                  setRenamingId(null)
                                  if (ok) { setEditingId(null); setEditingName('') }
                                }
                                if (e.key === 'Escape') { setEditingId(null); setEditingName('') }
                              }}
                              className="w-full max-w-[200px] px-2 py-1 text-xs border border-blue-300 bg-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-200"
                              disabled={renamingId === att.id}
                              autoFocus
                            />
                            <button
                              onClick={async () => {
                                setRenamingId(att.id)
                                const ok = await onRenameAttachment(att, editingName)
                                setRenamingId(null)
                                if (ok) { setEditingId(null); setEditingName('') }
                              }}
                              disabled={renamingId === att.id}
                              className="text-[10px] px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded font-medium transition disabled:opacity-60"
                            >
                              {renamingId === att.id ? '…' : 'Save'}
                            </button>
                            <button
                              onClick={() => { setEditingId(null); setEditingName('') }}
                              className="text-[10px] px-2 py-1 bg-slate-100 text-slate-600 rounded font-medium transition"
                            >✕</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2.5">
                            <Paperclip size={16} className="flex-shrink-0 text-blue-600" />
                            <button
                              onClick={() => onDrillDown(att)}
                              className="text-sm font-semibold truncate max-w-[220px] text-left transition text-slate-800 hover:text-blue-600 hover:underline cursor-pointer"
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
                          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3">
                        {children > 0 ? (
                          <button onClick={() => onDrillDown(att)}
                            className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full transition">
                            <Paperclip size={14} /> {children}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => onViewFile(att.gdrive_url, label)}
                            className="text-[10px] font-semibold px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition">
                            👁 View
                          </button>
                          <button type="button" onClick={() => onDownloadFile(att.gdrive_url, label)}
                            className="text-[10px] font-semibold px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 transition">
                            ⬇
                          </button>
                          <button onClick={() => onDrillDown(att)}
                            className="text-[10px] font-semibold px-2 py-1 bg-violet-50 text-violet-700 border border-violet-200 rounded hover:bg-violet-100 transition"
                            title="Open & explore this file's attachments">
                            📂 Open
                          </button>
                          <button
                            onClick={() => { setEditingId(att.id); setEditingName(att.title || att.file_name || '') }}
                            disabled={!canEditOrder}
                            className="text-[10px] font-semibold px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 transition disabled:opacity-50">
                            ✏️
                          </button>
                          <button onClick={() => canEditOrder && onDeleteAttachment(att)} disabled={!canEditOrder}
                            className="text-[10px] font-semibold px-2 py-1 bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 transition disabled:opacity-50">
                            🗑️
                          </button>
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
  )
}

// ── Left-panel list node ───────────────────────────────────────────────────────

function OrderListNode({
  order, isSelected, onSelect, attachmentsMap, uploadingId,
}: {
  order: SOWithUrl
  isSelected: boolean
  onSelect: (order: SOWithUrl) => void
  attachmentsMap: Map<string, SOAttachment[]>
  uploadingId: string | null
}) {
  const topLevelCount = (attachmentsMap.get(order.id) ?? []).filter(a => !a.parent_id).length
  const statusColor =
    order.status === 'ACTIVE'   ? '#3b63b8' :
    order.status === 'ARCHIVED' ? '#f59e0b' : '#94a3b8'

  return (
    <div
      className={`flex items-center gap-1.5 pr-2 pl-2.5 py-2.5 rounded-lg mb-0.5 cursor-pointer transition mx-2 ${
        isSelected ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
      }`}
      onClick={() => onSelect(order)}
    >
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor }} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold truncate leading-tight">{order.reference}</p>
        <p className={`text-[11px] truncate leading-tight ${isSelected ? 'text-blue-200' : 'text-slate-400'}`}>
          {order.subject}
        </p>
      </div>
      {topLevelCount > 0 && (
        <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none flex items-center gap-0.5 ${
          isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-500'
        }`}>
          <Paperclip size={11} /> {topLevelCount}
        </span>
      )}
      {uploadingId === order.id && (
        <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin block flex-shrink-0 opacity-70" />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════════════════════════════

export default function AdminOrdersPage() {
  const { toast } = useToast()
  const { user }  = useAuth()
  const canEditOrder = user ? !['DPDA', 'DPDO'].includes(user.role) : false

  const [orders,         setOrders]         = useState<SOWithUrl[]>([])
  const [query,          setQuery]          = useState('')
  const [statusFilter,   setStatusFilter]   = useState('ALL')
  const [loading,        setLoading]        = useState(true)
  const [attachmentsMap, setAttachmentsMap] = useState<Map<string, SOAttachment[]>>(new Map())
  const [selectedOrder,  setSelectedOrder]  = useState<SOWithUrl | null>(null)
  const [uploadingId,    setUploadingId]    = useState<string | null>(null)

  useRealtimeSpecialOrders({ setOrders, setAttachmentsMap, user })

  const [navStack,   setNavStack]   = useState<NavEntry[]>([])
  const [viewerFile, setViewerFile] = useState<{ url: string; name: string } | null>(null)

  const deleteAttDisc  = useDisclosure<SOAttachment>()
  const newSOModal     = useModal()
  const archiveDisc    = useDisclosure<SOWithUrl>()
  const deleteDisc     = useDisclosure<SOWithUrl>()
  const editOrderDisc  = useDisclosure<SOWithUrl>()
  const [forwardModalOpen, setForwardModalOpen] = useState(false)

  const currentEntry: NavEntry | null = navStack.length > 0 ? navStack[navStack.length - 1] : null

  const currentAttachments = useMemo((): SOAttachment[] => {
    if (!currentEntry) return []
    if (currentEntry.kind === 'order') {
      return (attachmentsMap.get(currentEntry.order.id) ?? []).filter(a => !a.parent_id)
    } else {
      return attachmentsMap.get(currentEntry.att.id) ?? []
    }
  }, [currentEntry, attachmentsMap])

  // ── Load — FIX: filter by uploaded_by unless user is privileged ─────────
  useEffect(() => {
    async function loadAll() {
      if (!user) return
      try {
        const [data, archived] = await Promise.all([getSpecialOrders(), getArchivedDocs()])
        const archivedIds = new Set(
          (archived ?? [])
            .map((a: any) => String(a.id ?? ''))
            .filter((id: string) => id.startsWith('arc-so-'))
            .map((id: string) => id.replace('arc-so-', ''))
        )

        // FIX: privileged roles see all orders; everyone else sees only their own.
        const activeOrders = data.filter((o: SOWithUrl) => {
          if (o.status === 'ARCHIVED' || archivedIds.has(o.id)) return false
          if (canSeeAllDocuments(user.role)) return true        // privileged: see all
          return !o.uploaded_by || o.uploaded_by === user.role  // own orders only
          //      ↑ `!o.uploaded_by` keeps legacy records visible during migration
        })

        setOrders(activeOrders)

        const allIds = activeOrders.map((o: SOWithUrl) => o.id)
        if (allIds.length > 0) {
          const { data: allAtts, error } = await supabase
            .from('special_order_attachments')
            .select('*')
            .in('special_order_id', allIds)
            .order('created_at', { ascending: true })

          if (error) {
            console.error('Failed to load attachments:', error.message)
          } else {
            const map = new Map<string, SOAttachment[]>()
            for (const row of (allAtts ?? [])) {
              const att = normaliseAttachment(row)
              const key = att.parent_id ?? att.special_order_id
              const list = map.get(key) ?? []
              list.push(att)
              map.set(key, list)
            }
            setAttachmentsMap(map)
          }
        }

        if (activeOrders.length > 0) {
          const first = activeOrders[0]
          setSelectedOrder(first)
          setNavStack([{ kind: 'order', order: first }])
        }
      } catch (err) {
        console.error('loadAll error:', err)
      } finally {
        setLoading(false)
      }
    }
    loadAll()
  }, [user])

  function handleSelectOrder(order: SOWithUrl) {
    setSelectedOrder(order)
    setNavStack([{ kind: 'order', order }])
  }

  function handleDrillDown(att: SOAttachment) {
    setNavStack(prev => [...prev, { kind: 'attachment', att }])
  }

  function handleNavigateTo(index: number) {
    setNavStack(prev => prev.slice(0, index + 1))
  }

  async function handleUpload(parentOrderId: string, parentAttId: string | null, files: FileList) {
    if (!user) { toast.error('Not authenticated.'); return }

    setUploadingId(parentAttId ?? parentOrderId)
    let count = 0

    for (const file of Array.from(files)) {
      const driveResult = await uploadAttachmentToDrive(file, user.role, parentOrderId, parentAttId)

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

      const newAtt = await dbAddAttachment({
        special_order_id: parentOrderId,
        parent_id:        parentAttId,
        depth:            parentDepth,
        title:            file.name,
        file_name:        file.name,
        file_size_bytes:  file.size,
        mime_type:        file.type || null,
        gdrive_file_id:   driveResult.gdriveFileId,
        gdrive_url:       driveResult.gdrive_url,
        pool_account_id:  driveResult.poolAccountId,
      })

      if (newAtt) {
        const mapKey = parentAttId ?? parentOrderId
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

  async function handleAdd(newSO: SOWithUrl) {
    await addSpecialOrder(newSO)
    setOrders(prev => [newSO, ...prev])
    setAttachmentsMap(prev => { const next = new Map(prev); next.set(newSO.id, []); return next })
    setSelectedOrder(newSO)
    setNavStack([{ kind: 'order', order: newSO }])
  }

  async function handleArchiveOrder() {
    const so = archiveDisc.payload
    if (!so) return
    const today = new Date().toISOString().split('T')[0]
    await archiveSpecialOrder(so.id)
    await addArchivedDoc({
      id: `arc-so-${so.id}`, title: `${so.reference} – ${so.subject}`,
      type: 'Special Order', archivedDate: today, archivedBy: 'Admin',
    })
    setOrders(prev => prev.filter(o => o.id !== so.id))
    setSelectedOrder(null)
    setNavStack([])
    toast.success(`"${so.reference}" has been moved to the Archive.`)
    archiveDisc.close()
  }

  async function handleDeleteOrder() {
    const so = deleteDisc.payload
    if (!so) return
    await deleteSpecialOrder(so.id)
    await logDeleteDocument(`${so.reference} - ${so.subject}`, 'special order')
    setOrders(prev => prev.filter(o => o.id !== so.id))
    if (selectedOrder?.id === so.id) { setSelectedOrder(null); setNavStack([]) }
    toast.success(`"${so.reference}" deleted permanently.`)
    deleteDisc.close()
  }

  async function handleSaveOrder(updatedOrder: SOWithUrl) {
    await updateSpecialOrder(updatedOrder)
    await logAction('edit_document', `Edited special order "${updatedOrder.reference} - ${updatedOrder.subject}"`)
    setOrders(prev => prev.map(order => order.id === updatedOrder.id ? updatedOrder : order))
    if (selectedOrder?.id === updatedOrder.id) setSelectedOrder(updatedOrder)
    setNavStack(prev => prev.map(entry => (
      entry.kind === 'order' && entry.order.id === updatedOrder.id
        ? { kind: 'order', order: updatedOrder }
        : entry
    )))
    toast.success('Special Order updated.')
    editOrderDisc.close()
  }

  async function handleDeleteAttachment() {
    const att = deleteAttDisc.payload
    if (!att) return
    const ok = await dbDeleteAttachment(att.id)
    if (!ok) { toast.error('Could not delete attachment.'); return }
    const mapKey = att.parent_id ?? att.special_order_id
    setAttachmentsMap(prev => {
      const next = new Map(prev)
      next.set(mapKey, (next.get(mapKey) ?? []).filter(a => a.id !== att.id))
      return next
    })
    toast.success(`"${displayName(att)}" deleted.`)
    deleteAttDisc.close()
    if (currentEntry?.kind === 'attachment' && currentEntry.att.id === att.id) {
      setNavStack(prev => prev.slice(0, -1))
    }
  }

  async function handleRenameAttachment(att: SOAttachment, newTitle: string): Promise<boolean> {
    const trimmed = newTitle.trim()
    if (!trimmed) { toast.error('Title cannot be empty.'); return false }
    if (trimmed === att.title) return true
    const ok = await dbRenameAttachment(att.id, trimmed)
    if (!ok) { toast.error('Failed to rename attachment.'); return false }
    await logRenameAttachment(att.title, trimmed)
    const mapKey = att.parent_id ?? att.special_order_id
    setAttachmentsMap(prev => {
      const next = new Map(prev)
      next.set(mapKey, (next.get(mapKey) ?? []).map(a => a.id === att.id ? { ...a, title: trimmed } : a))
      return next
    })
    toast.success('Attachment renamed.')
    return true
  }

  const handleDownloadFile = useCallback(async (fileUrl: string, fileName: string) => {
    try {
      await saveFileFromUrl(fileUrl, getSuggestedFileName(fileName, fileUrl))
      await logDownloadDocument(fileName)
      toast.success(`Downloaded "${fileName}" successfully.`)
    } catch { toast.error('Could not download the file.') }
  }, [toast])

  const handlePrintFile = useCallback(async (fileUrl: string, fileName: string, _sourceDocumentId?: string) => {
    try {
      await printFileFromUrl(fileUrl)
      await logViewDocument(fileName)
      toast.success(`Opened print preview for "${fileName}".`)
    } catch { toast.error('Could not print the file.') }
  }, [toast])

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter(o =>
      (statusFilter === 'ALL' || o.status === statusFilter) &&
      (!q || o.reference.toLowerCase().includes(q) || o.subject.toLowerCase().includes(q))
    )
  }, [orders, query, statusFilter])

  function handleViewFile(fileUrl: string, fileName: string) {
    setViewerFile({ url: fileUrl, name: fileName })
    logViewDocument(fileName).catch(() => {})
  }

  return (
    <>
      <PageHeader title="Admin Orders" />

      <div className="p-6 flex flex-col gap-5 flex-1" style={{ height: 'calc(100vh - 56px)' }}>
        <div className="bg-white border-[1.5px] border-slate-200 rounded-xl overflow-hidden flex flex-col flex-1 min-h-0">

          {/* Toolbar */}
          <div className="flex items-center gap-2.5 px-6 py-4 border-b border-slate-100 bg-slate-50 flex-shrink-0">
            <SearchInput value={query} onChange={setQuery} placeholder="Search orders…" className="max-w-xs flex-1" />
            <ToolbarSelect
              defaultValue="ALL"
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="PENDING">Pending</option>
            </ToolbarSelect>
            <Button variant="primary" size="sm" className="ml-auto" onClick={newSOModal.open}>
              + New SO
            </Button>
          </div>

          {/* Split view */}
          <div className="flex flex-1 min-h-0 overflow-hidden">

            {/* Left: order list */}
            <div className="flex-shrink-0 border-r border-slate-200 flex flex-col overflow-hidden" style={{ width: 280 }}>
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex-shrink-0">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 leading-none">
                  Orders · {filteredOrders.length}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">Click to view attachments</p>
              </div>

              <div className="flex-1 overflow-y-auto py-2">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : filteredOrders.length === 0 ? (
                  <EmptyState icon="📋" title="No orders found" description="Create your first order." />
                ) : (
                  filteredOrders.map(order => (
                    <OrderListNode
                      key={order.id}
                      order={order}
                      isSelected={selectedOrder?.id === order.id}
                      onSelect={handleSelectOrder}
                      attachmentsMap={attachmentsMap}
                      uploadingId={uploadingId}
                    />
                  ))
                )}
              </div>

              {/* Legend */}
              <div className="px-4 py-3 border-t border-slate-100 space-y-1.5 flex-shrink-0">
                {[
                  { color: '#3b63b8', label: 'Active' },
                  { color: '#f59e0b', label: 'Archived' },
                  { color: '#94a3b8', label: 'Other' },
                ].map(l => (
                  <div key={l.label} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: l.color }} />
                    <span className="text-[11px] text-slate-400">{l.label}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1 border-t border-slate-100 mt-1">
                  <Paperclip className="h-3 w-3 text-slate-400" />
                  <span className="text-[11px] text-slate-400">= top-level attachments</span>
                </div>
              </div>
            </div>

            {/* Right: attachment detail with drill-down */}
            <div className="flex-1 overflow-y-auto p-6">
              {!currentEntry ? (
                <div className="h-full flex items-center justify-center">
                  <EmptyState
                    icon="📋"
                    title="Select an order"
                    description="Click any order from the list on the left to view its attachments."
                    action={<Button variant="primary" size="sm" onClick={newSOModal.open}>+ New SO</Button>}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <AttachmentsTablePanel
                    navStack={navStack}
                    currentEntry={currentEntry}
                    attachments={currentAttachments}
                    allAttachments={attachmentsMap}
                    onUpload={handleUpload}
                    uploadingId={uploadingId}
                    onForwardOrder={() => setForwardModalOpen(true)}
                    onArchiveOrder={() => selectedOrder && archiveDisc.open(selectedOrder)}
                    onDeleteOrder={() => selectedOrder && deleteDisc.open(selectedOrder)}
                    canEditOrder={canEditOrder}
                    onEditOrder={() => selectedOrder && editOrderDisc.open(selectedOrder)}
                    onViewFile={handleViewFile}
                    onDownloadFile={handleDownloadFile}
                    onPrintFile={handlePrintFile}
                    onDeleteAttachment={att => deleteAttDisc.open(att)}
                    onDrillDown={handleDrillDown}
                    onNavigateTo={handleNavigateTo}
                    onRenameAttachment={handleRenameAttachment}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AddSpecialOrderModal open={newSOModal.isOpen} onClose={newSOModal.close} onAdd={handleAdd} />

      <EditSpecialOrderModal
        open={editOrderDisc.isOpen}
        order={editOrderDisc.payload ?? null}
        onClose={editOrderDisc.close}
        onSave={handleSaveOrder}
      />

      {selectedOrder && (
        <ForwardDocumentModal
          open={forwardModalOpen}
          onClose={() => setForwardModalOpen(false)}
          document={{
            id:            selectedOrder.id,
            title:         selectedOrder.subject,
            type:          'Special Order',
            documentType:  'admin_order',
            gdriveFileId:  (selectedOrder as any).gdrive_file_id  ?? '',
            gdriveUrl:     (selectedOrder as any).gdrive_url       ?? selectedOrder.fileUrl ?? '',
            poolAccountId: (selectedOrder as any).pool_account_id  ?? '',
            fileName:      (selectedOrder as any).file_name        ?? undefined,
            fileSizeBytes: (selectedOrder as any).file_size_bytes  ?? undefined,
            mimeType:      (selectedOrder as any).mime_type        ?? undefined,
          }}
          attachmentsMap={attachmentsMap as any}
          onForwarded={() => setForwardModalOpen(false)}
          senderRole={user?.role as AdminRole}
        />
      )}

      {viewerFile && (
        <InlineFileViewerModal
          fileUrl={viewerFile.url}
          fileName={viewerFile.name}
          open={!!viewerFile}
          onClose={() => setViewerFile(null)}
        />
      )}

      <ConfirmDialog
        open={archiveDisc.isOpen}
        title="Archive Special Order"
        message={`Archive "${archiveDisc.payload?.reference}"? It will be moved to the Archive page.`}
        confirmLabel="Archive" variant="danger"
        onConfirm={handleArchiveOrder}
        onCancel={archiveDisc.close}
      />

      <ConfirmDialog
        open={deleteAttDisc.isOpen}
        title="Delete Attachment"
        message={`Delete "${deleteAttDisc.payload ? displayName(deleteAttDisc.payload) : ''}" permanently? This cannot be undone.`}
        confirmLabel="Delete" variant="danger"
        onConfirm={handleDeleteAttachment}
        onCancel={deleteAttDisc.close}
      />

      <ConfirmDialog
        open={deleteDisc.isOpen}
        title="Delete Special Order"
        message={`Delete "${deleteDisc.payload?.reference}" permanently? This cannot be undone.`}
        confirmLabel="Delete" variant="danger"
        onConfirm={handleDeleteOrder}
        onCancel={deleteDisc.close}
      />
    </>
  )
}