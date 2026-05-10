'use client'
// app/admin/admin-orders/page.tsx
// Aligned with Master Documents UI & logic

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
import { logAction, logDeleteDocument, logRenameAttachment, logViewDocument } from '@/lib/adminLogger'
import { useAuth } from '@/lib/auth'
import type { AdminRole } from '@/lib/auth'
import { useRealtimeSpecialOrders } from '@/hooks/useRealtimeSpecialOrders'
import { useDriveUpload } from '@/hooks/useGDriveTool'
import type { SpecialOrder }    from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────
type SOWithUrl = SpecialOrder & { fileUrl?: string }

export interface SOAttachment {
  id: string
  special_order_id: string
  parent_attachment_id: string | null
  file_name: string
  file_url: string
  file_size: string
  file_type: string
  uploaded_at: string
  uploaded_by: string
  archived: boolean
}

type NavEntry =
  | { kind: 'order';      order: SOWithUrl }
  | { kind: 'attachment'; att: SOAttachment }

// ── Supabase helpers ───────────────────────────────────────────────────────
function normaliseAttachment(row: any): SOAttachment {
  return {
    id:                   row.id,
    special_order_id:     row.special_order_id,
    parent_attachment_id: row.parent_attachment_id ?? null,
    file_name:            row.file_name,
    file_url:             row.file_url,
    file_size:            row.file_size,
    file_type:            row.file_type,
    uploaded_at:          row.uploaded_at,
    uploaded_by:          row.uploaded_by,
    archived:             row.archived === true,
  }
}

async function dbAddAttachment(
  att: Omit<SOAttachment, 'uploaded_at'>
): Promise<SOAttachment | null> {
  const { data, error } = await supabase
    .from('special_order_attachments')
    .insert({ ...att, archived: false, uploaded_at: new Date().toISOString() })
    .select()
    .single()
  if (error) { console.error('addAttachment error:', error.message); return null }
  return normaliseAttachment(data)
}

async function dbArchiveAttachment(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('special_order_attachments')
    .update({ archived: true })
    .eq('id', id)
    .select('id, archived')
    .single()
  if (error) { console.error('archiveAttachment DB error:', error.message); return false }
  return data?.archived === true
}

async function dbRestoreAttachment(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('special_order_attachments')
    .update({ archived: false })
    .eq('id', id)
    .select('id, archived')
    .single()
  if (error) { console.error('restoreAttachment DB error:', error.message); return false }
  return data?.archived === false
}

async function dbRenameAttachment(id: string, newName: string): Promise<boolean> {
  const { error } = await supabase
    .from('special_order_attachments')
    .update({ file_name: newName })
    .eq('id', id)
  if (error) { console.error('renameAttachment DB error:', error.message); return false }
  return true
}

// ── File-type helpers ──────────────────────────────────────────────────────
function fileInfo(name: string) {
  if (name.match(/\.pdf$/i))
    return { icon: '📕', label: 'PDF',  color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200',    badgeCls: 'bg-red-100 text-red-700'      }
  if (name.match(/\.docx?$/i))
    return { icon: '📘', label: 'DOCX', color: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-200',   badgeCls: 'bg-blue-100 text-blue-700'    }
  if (name.match(/\.xlsx?$/i))
    return { icon: '📗', label: 'XLSX', color: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-200',  badgeCls: 'bg-green-100 text-green-700'  }
  if (name.match(/\.(jpg|jpeg|png|webp)$/i))
    return { icon: '🖼️', label: 'IMG',  color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-200', badgeCls: 'bg-violet-100 text-violet-700' }
  return   { icon: '📄', label: 'FILE', color: 'text-slate-600',  bg: 'bg-slate-50',  border: 'border-slate-200',  badgeCls: 'bg-slate-100 text-slate-600'  }
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
      finish(() => { cleanup(); reject(new Error('Print timed out.')) })
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
            finish(() => { cleanup(); reject(new Error('Unable to load printable content.')) })
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
          finish(() => { cleanup(); reject(new Error('Could not load file for printing.')) })
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

// ══════════════════════════════════════════════════════════════════════════
// Inline File Viewer Modal
// ══════════════════════════════════════════════════════════════════════════
function InlineFileViewerModal({
  fileUrl, fileName, open, onClose,
}: { fileUrl: string; fileName: string; open: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const [isDownloading, setIsDownloading] = useState(false)
  const isPDF   = !!fileUrl.match(/\.pdf(\?|$)/i)
  const isImage = !!fileUrl.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)
  const fi      = fileInfo(fileName)

  async function handleDownload() {
    try {
      setIsDownloading(true)
      await saveFileFromUrl(fileUrl, getSuggestedFileName(fileName, fileUrl))
      toast.success(`Downloaded "${fileName}" successfully.`)
    } catch (error) {
      console.error('download error:', error)
      toast.error('Could not download the file.')
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
              className="text-[11px] font-semibold px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
            >
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

function EditSpecialOrderModal({
  open,
  order,
  onClose,
  onSave,
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
      subject: order.subject,
      date: order.date,
      status: order.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
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
            <input
              type="date"
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
          <label className="block text-[11px] font-semibold uppercase tracking-widests text-slate-500 mb-1.5">Status</label>
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

// ══════════════════════════════════════════════════════════════════════════
// Breadcrumb
// ══════════════════════════════════════════════════════════════════════════
function Breadcrumb({
  navStack,
  onNavigateTo,
}: {
  navStack: NavEntry[]
  onNavigateTo: (index: number) => void
}) {
  if (navStack.length <= 1) return null

  return (
    <div className="flex items-center gap-0 flex-wrap mb-4 px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl">
      <span className="text-slate-400 mr-1 text-sm">🗂</span>
      {navStack.map((entry, i) => {
        const label = entry.kind === 'order' ? `${entry.order.reference} – ${entry.order.subject}` : entry.att.file_name
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

// ══════════════════════════════════════════════════════════════════════════
// Attachments Table Panel
// ══════════════════════════════════════════════════════════════════════════
function AttachmentsTablePanel({
  navStack,
  currentEntry,
  attachments,
  allAttachments,
  onUpload,
  uploadingId,
  onForwardOrder,
  onArchiveOrder,
  onDeleteOrder,
  canEditOrder,
  onEditOrder,
  onViewFile,
  onDownloadFile,
  onPrintFile,
  onArchiveAttachment,
  onRestoreAttachment,
  onDrillDown,
  onNavigateTo,
  onRenameAttachment,
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
  onArchiveAttachment: (att: SOAttachment) => void
  onRestoreAttachment: (att: SOAttachment) => void
  onDrillDown: (att: SOAttachment) => void
  onNavigateTo: (index: number) => void
  onRenameAttachment: (att: SOAttachment, newName: string) => Promise<boolean>
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)

  const activeAttachments   = attachments.filter(a => !a.archived)
  const archivedAttachments = attachments.filter(a =>  a.archived)
  const displayed           = showArchived ? archivedAttachments : activeAttachments

  const isDrillDown = currentEntry.kind === 'attachment'
  const currentOrder = currentEntry.kind === 'order' ? currentEntry.order : null
  const currentLabel = isDrillDown
    ? (currentEntry as { kind: 'attachment'; att: SOAttachment }).att.file_name
    : `${currentOrder!.reference} – ${currentOrder!.subject}`

  const rootOrderId = navStack[0].kind === 'order' ? navStack[0].order.id : ''
  const parentAttId = isDrillDown ? (currentEntry as { kind: 'attachment'; att: SOAttachment }).att.id : null

  function childCount(attId: string): number {
    return (allAttachments.get(attId) ?? []).filter(a => !a.archived).length
  }

  const drillAtt = isDrillDown ? (currentEntry as { kind: 'attachment'; att: SOAttachment }).att : null
  const drillFi  = drillAtt ? fileInfo(drillAtt.file_name) : null

  return (
    <div className="animate-fade-up h-full flex flex-col">

      {/* Breadcrumb */}
      <Breadcrumb navStack={navStack} onNavigateTo={onNavigateTo} />

      {/* Back Button */}
      {navStack.length > 1 && (
        <button
          onClick={() => onNavigateTo(navStack.length - 2)}
          className="inline-flex items-center gap-2 mb-4 px-4 py-2 bg-white border-2 border-slate-300 hover:border-blue-500 hover:bg-blue-50 text-slate-700 hover:text-blue-700 rounded-xl font-semibold text-sm transition-all shadow-sm hover:shadow-md self-start"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          <span>
            Back to{' '}
            <span className="font-bold">
              {navStack.length >= 2
                ? navStack[navStack.length - 2].kind === 'order'
                  ? `${(navStack[navStack.length - 2] as { kind: 'order'; order: SOWithUrl }).order.reference}`
                  : (navStack[navStack.length - 2] as { kind: 'attachment'; att: SOAttachment }).att.file_name
                : 'Orders'}
            </span>
          </span>
        </button>
      )}

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
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-medium">{drillAtt.file_size}</span>
              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
                📅 {new Date(drillAtt.uploaded_at).toLocaleString('en-PH', {
                  year: 'numeric', month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          )}
          {!isDrillDown && currentOrder && (
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {currentOrder.created_at && (
                <span className="text-xs text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full font-medium">
                  📅 {new Date(currentOrder.created_at).toLocaleString('en-PH', {
                    year: 'numeric', month: 'short', day: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              )}
              <Badge className={statusBadgeClass(currentOrder.status)}>{currentOrder.status}</Badge>
            </div>
          )}
        </div>

        {!isDrillDown && (
          <div className="flex gap-2 flex-shrink-0">
            {canEditOrder && <Button variant="primary"  size="sm" onClick={onForwardOrder}>🔀 Forward</Button>}
            {canEditOrder && <Button variant="outline"  size="sm" onClick={onEditOrder}>✏ Edit</Button>}
            {canEditOrder && <Button variant="danger"   size="sm" onClick={onArchiveOrder}>🗄️ Archive</Button>}
            {canEditOrder && <Button variant="danger"   size="sm" onClick={onDeleteOrder}>🗑️ Delete</Button>}
          </div>
        )}

        {isDrillDown && drillAtt && (
          <div className="flex gap-1.5 flex-shrink-0">
            <button onClick={() => onViewFile(drillAtt.file_url, drillAtt.file_name)}
              className="text-xs px-2.5 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg font-semibold hover:bg-blue-100 transition">
              👁 View File
            </button>
            <button type="button" onClick={() => onDownloadFile(drillAtt.file_url, drillAtt.file_name)}
              className="text-xs px-2.5 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg font-semibold hover:bg-slate-200 transition">
              ⬇ Download
            </button>
            <button type="button" onClick={() => onPrintFile(drillAtt.file_url, drillAtt.file_name, drillAtt.special_order_id)}
              className="text-xs px-2.5 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg font-semibold hover:bg-green-100 transition">
              🖨️ Print
            </button>
            <button onClick={() => onArchiveAttachment(drillAtt)} disabled={!canEditOrder}
              className="text-xs px-2.5 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg font-semibold hover:bg-amber-100 transition disabled:opacity-50 disabled:cursor-not-allowed">
              🗄️ Archive
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
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Attachments</span>
            <div className="flex items-center rounded-lg border border-slate-300 overflow-hidden bg-white shadow-sm">
              <button
                onClick={() => setShowArchived(false)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all ${
                  !showArchived ? 'bg-blue-600 text-white shadow-inner' : 'bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${
                  !showArchived ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-600'
                }`}>
                  {activeAttachments.length}
                </span>
                Active
              </button>
              <div className="w-px h-full bg-slate-300" />
              <button
                onClick={() => setShowArchived(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-all ${
                  showArchived ? 'bg-amber-500 text-white shadow-inner' : 'bg-white text-slate-600 hover:bg-amber-50 hover:text-amber-700'
                }`}
              >
                <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${
                  showArchived ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-600'
                }`}>
                  {archivedAttachments.length}
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
            {!showArchived && canEditOrder && (
              <Button variant="primary" size="sm" disabled={!!uploadingId}
                onClick={() => fileInputRef.current?.click()}>
                + Attach file
              </Button>
            )}
          </div>
        </div>

        {/* Body */}
        {displayed.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-14 px-6">
            <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-2xl mb-3">
              {showArchived ? '🗄️' : '📎'}
            </div>
            <p className="text-sm font-semibold text-slate-600 mb-1">
              {showArchived ? 'No archived attachments' : `No ${isDrillDown ? 'child ' : ''}attachments yet`}
            </p>
            <p className="text-xs text-slate-400 mb-4 max-w-xs">
              {showArchived
                ? 'Files you archive will appear here and can be restored.'
                : canEditOrder
                  ? 'Click + Attach file to upload supporting documents.'
                  : 'View-only access — no attachments yet.'}
            </p>
            {!showArchived && canEditOrder && (
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
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400">File name</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[80px]">Type</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[90px]">Size</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[130px]">Uploaded</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[90px]">By</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[90px]">Children</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400 w-[220px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(att => {
                  const fi       = fileInfo(att.file_name)
                  const children = childCount(att.id)
                  const isEditing = editingId === att.id
                  return (
                    <tr key={att.id}
                      className={`border-b border-slate-100 transition-colors group ${
                        att.archived ? 'bg-amber-50/40 hover:bg-amber-50' : 'hover:bg-blue-50/50'
                      }`}
                    >
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
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2.5">
                            <Paperclip size={16} className="flex-shrink-0 text-blue-600" />
                            <button
                              disabled={att.archived}
                              onClick={() => !att.archived && onDrillDown(att)}
                              className={`text-sm font-semibold truncate max-w-[220px] text-left transition ${
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
                          year: 'numeric', month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{att.uploaded_by}</td>
                      <td className="px-4 py-3">
                        {!att.archived && children > 0 ? (
                          <button
                            onClick={() => onDrillDown(att)}
                            className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full transition"
                          >
                            <Paperclip size={14} /> {children}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!att.archived ? (
                            <>
                              <button onClick={() => onViewFile(att.file_url, att.file_name)}
                                className="text-[10px] font-semibold px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition">
                                👁 View
                              </button>
                              <button type="button" onClick={() => onDownloadFile(att.file_url, att.file_name)}
                                className="text-[10px] font-semibold px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 transition">
                                ⬇
                              </button>
                              <button onClick={() => onDrillDown(att)}
                                className="text-[10px] font-semibold px-2 py-1 bg-violet-50 text-violet-700 border border-violet-200 rounded hover:bg-violet-100 transition"
                                title="Open & explore this file's attachments">
                                📂 Open
                              </button>
                              <button
                                onClick={() => { setEditingId(att.id); setEditingName(att.file_name) }}
                                disabled={!canEditOrder}
                                className="text-[10px] font-semibold px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 transition">
                                ✏️
                              </button>
                              <button onClick={() => onArchiveAttachment(att)} disabled={!canEditOrder}
                                className="text-[10px] font-semibold px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100 transition">
                                🗄️
                              </button>
                            </>
                          ) : (
                            <button onClick={() => onRestoreAttachment(att)} disabled={!canEditOrder}
                              className="text-[10px] font-semibold px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100 transition">
                              ↩ Restore
                            </button>
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
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Left-panel list node
// ══════════════════════════════════════════════════════════════════════════
function OrderListNode({
  order,
  isSelected,
  onSelect,
  attachmentsMap,
  uploadingId,
}: {
  order: SOWithUrl
  isSelected: boolean
  onSelect: (order: SOWithUrl) => void
  attachmentsMap: Map<string, SOAttachment[]>
  uploadingId: string | null
}) {
  const activeCount = (attachmentsMap.get(order.id) ?? []).filter(a => !a.archived && !a.parent_attachment_id).length
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
      {activeCount > 0 && (
        <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
          isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-500'
        }`}>
          <Paperclip size={13} /> {activeCount}
        </span>
      )}
      {uploadingId === order.id && (
        <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin block flex-shrink-0 opacity-70" />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════════════════════════
export default function AdminOrdersPage() {
  const { toast } = useToast()
  const { user }  = useAuth()
  const canEditOrder = user ? !['DPDA', 'DPDO'].includes(user.role) : false

  // ── Drive upload hook ──────────────────────────────────────────────────
  const { uploadToDrive } = useDriveUpload()

  const [orders,         setOrders]         = useState<SOWithUrl[]>([])
  const [query,          setQuery]          = useState('')
  const [statusFilter,   setStatusFilter]   = useState('ALL')
  const [loading,        setLoading]        = useState(true)
  const [attachmentsMap, setAttachmentsMap] = useState<Map<string, SOAttachment[]>>(new Map())
  const [selectedOrder,  setSelectedOrder]  = useState<SOWithUrl | null>(null)
  const [uploadingId,    setUploadingId]    = useState<string | null>(null)
  const [archivingAtt,   setArchivingAtt]   = useState(false)

  useRealtimeSpecialOrders({ setOrders, setAttachmentsMap, user })

  const [navStack,    setNavStack]    = useState<NavEntry[]>([])
  const [viewerFile,  setViewerFile]  = useState<{ url: string; name: string } | null>(null)

  const archiveAttDisc = useDisclosure<SOAttachment>()
  const newSOModal     = useModal()
  const archiveDisc    = useDisclosure<SOWithUrl>()
  const deleteDisc     = useDisclosure<SOWithUrl>()
  const editOrderDisc  = useDisclosure<SOWithUrl>()
  const [forwardModalOpen, setForwardModalOpen] = useState(false)

  const currentEntry: NavEntry | null = navStack.length > 0 ? navStack[navStack.length - 1] : null

  const currentAttachments = useMemo((): SOAttachment[] => {
    if (!currentEntry) return []
    if (currentEntry.kind === 'order') {
      return (attachmentsMap.get(currentEntry.order.id) ?? []).filter(a => !a.parent_attachment_id)
    } else {
      return attachmentsMap.get(currentEntry.att.id) ?? []
    }
  }, [currentEntry, attachmentsMap])

  // ── Load orders + attachments ──────────────────────────────────────────
  useEffect(() => {
    async function loadAll() {
      try {
        const [data, archived] = await Promise.all([getSpecialOrders(), getArchivedDocs()])
        const archivedIds = new Set(
          (archived ?? [])
            .map((a: any) => String(a.id ?? ''))
            .filter((id: string) => id.startsWith('arc-so-'))
            .map((id: string) => id.replace('arc-so-', ''))
        )
        const activeOrders = data.filter((o: SOWithUrl) => o.status !== 'ARCHIVED' && !archivedIds.has(o.id))
        setOrders(activeOrders)

        const allIds = activeOrders.map((o: SOWithUrl) => o.id)
        if (allIds.length > 0) {
          const { data: allAtts, error } = await supabase
            .from('special_order_attachments')
            .select('*')
            .in('special_order_id', allIds)
            .order('uploaded_at', { ascending: true })

          if (error) {
            console.error('Failed to load attachments:', error.message)
          } else {
            const map = new Map<string, SOAttachment[]>()
            for (const row of (allAtts ?? [])) {
              const att = normaliseAttachment(row)
              const key = att.parent_attachment_id ?? att.special_order_id
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
  }, [])

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

  // ── MIGRATED: Drive Pool upload ────────────────────────────────────────
  async function handleUpload(parentOrderId: string, parentAttId: string | null, files: FileList) {
    setUploadingId(parentAttId ?? parentOrderId)
    let count = 0

    for (const file of Array.from(files)) {
      // Upload to Google Drive instead of supabase.storage
      const fileUrl = await uploadToDrive(file, 'special_orders', {
        uploadedBy: user?.role ?? 'Admin',
        entityId:   parentOrderId,
        entityType: 'special_order',
      })

      if (!fileUrl) {
        toast.error(`Failed to upload "${file.name}".`)
        continue
      }

      const ext = file.name.split('.').pop()?.toUpperCase() ?? 'FILE'

      const newAtt = await dbAddAttachment({
        id:                   `soa-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        special_order_id:     parentOrderId,
        parent_attachment_id: parentAttId,
        file_name:            file.name,
        file_url:             fileUrl,
        file_size:            file.size < 1024 * 1024
                                ? `${(file.size / 1024).toFixed(1)} KB`
                                : `${(file.size / 1024 / 1024).toFixed(1)} MB`,
        file_type:            ext,
        uploaded_by:          user?.role ?? 'Admin',
        archived:             false,
      })

      if (newAtt) {
        const mapKey = parentAttId ?? parentOrderId
        setAttachmentsMap(prev => {
          const next = new Map(prev)
          next.set(mapKey, [...(next.get(mapKey) ?? []), newAtt])
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
      id:           `arc-so-${so.id}`,
      title:        `${so.reference} – ${so.subject}`,
      type:         'Special Order',
      archivedDate: today,
      archivedBy:   'Admin',
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
    await logDeleteDocument(`${so.reference} - ${so.subject}`, 'special order', user?.role as AdminRole)
    setOrders(prev => prev.filter(o => o.id !== so.id))
    if (selectedOrder?.id === so.id) {
      setSelectedOrder(null)
      setNavStack([])
    }
    toast.success(`"${so.reference}" deleted permanently.`)
    deleteDisc.close()
  }

  async function handleSaveOrder(updatedOrder: SOWithUrl) {
    await updateSpecialOrder(updatedOrder)
    await logAction('edit_document', `Edited special order "${updatedOrder.reference} - ${updatedOrder.subject}"`, user?.role as AdminRole)
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

  async function handleArchiveAttachment() {
    const att = archiveAttDisc.payload
    if (!att) return
    setArchivingAtt(true)
    try {
      const ok = await dbArchiveAttachment(att.id)
      if (!ok) { toast.error('Could not archive attachment — the database update failed.'); return }
      const mapKey = att.parent_attachment_id ?? att.special_order_id
      setAttachmentsMap(prev => {
        const next = new Map(prev)
        const list = next.get(mapKey) ?? []
        next.set(mapKey, list.map(a => a.id === att.id ? { ...a, archived: true } : a))
        return next
      })
      toast.success(`"${att.file_name}" archived.`)
      archiveAttDisc.close()
      if (currentEntry?.kind === 'attachment' && currentEntry.att.id === att.id) {
        setNavStack(prev => prev.slice(0, -1))
      }
    } finally {
      setArchivingAtt(false)
    }
  }

  async function handleRestoreAttachment(att: SOAttachment) {
    const ok = await dbRestoreAttachment(att.id)
    if (!ok) { toast.error('Could not restore attachment.'); return }
    const mapKey = att.parent_attachment_id ?? att.special_order_id
    setAttachmentsMap(prev => {
      const next = new Map(prev)
      const list = next.get(mapKey) ?? []
      next.set(mapKey, list.map(a => a.id === att.id ? { ...a, archived: false } : a))
      return next
    })
    toast.success(`"${att.file_name}" restored.`)
  }

  async function handleRenameAttachment(att: SOAttachment, newName: string): Promise<boolean> {
    const trimmed = newName.trim()
    if (!trimmed) { toast.error('File name cannot be empty.'); return false }
    if (trimmed === att.file_name) return true
    const ok = await dbRenameAttachment(att.id, trimmed)
    if (!ok) { toast.error('Failed to rename attachment.'); return false }
    await logRenameAttachment(att.file_name, trimmed, user?.role)
    const mapKey = att.parent_attachment_id ?? att.special_order_id
    setAttachmentsMap(prev => {
      const next = new Map(prev)
      const list = next.get(mapKey) ?? []
      next.set(mapKey, list.map(a => a.id === att.id ? { ...a, file_name: trimmed } : a))
      return next
    })
    toast.success('Attachment renamed.')
    return true
  }

  const handleDownloadFile = useCallback(async (fileUrl: string, fileName: string) => {
    try {
      await saveFileFromUrl(fileUrl, getSuggestedFileName(fileName, fileUrl))
      toast.success(`Downloaded "${fileName}" successfully.`)
    } catch (error) {
      console.error('download error:', error)
      toast.error('Could not download the file.')
    }
  }, [toast])

  const handlePrintFile = useCallback(async (fileUrl: string, fileName: string, sourceDocumentId?: string) => {
    try {
      await printFileFromUrl(fileUrl)
      toast.success(`Opened print preview for "${fileName}".`)
    } catch (error) {
      console.error('print error:', error)
      toast.error('Could not print the file.')
    }
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
                    onArchiveAttachment={att => archiveAttDisc.open(att)}
                    onRestoreAttachment={handleRestoreAttachment}
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
            id:           selectedOrder.id,
            title:        selectedOrder.subject,
            type:         'Special Order',
            fileUrl:      selectedOrder.fileUrl,
            documentType: 'admin_order',
          }}
          documentData={selectedOrder}
          attachmentsMap={attachmentsMap}
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
        message={`Archive "${archiveDisc.payload?.reference}"? It will be moved to the Archive page and can be restored from there.`}
        confirmLabel="Archive"
        variant="danger"
        onConfirm={handleArchiveOrder}
        onCancel={archiveDisc.close}
      />

      <ConfirmDialog
        open={archiveAttDisc.isOpen}
        title="Archive Attachment"
        message={`Archive "${archiveAttDisc.payload?.file_name}"? It will be hidden from active view but can be restored at any time.`}
        confirmLabel={archivingAtt ? 'Archiving…' : 'Archive'}
        variant="primary"
        onConfirm={handleArchiveAttachment}
        onCancel={archiveAttDisc.close}
      />

      <ConfirmDialog
        open={deleteDisc.isOpen}
        title="Delete Special Order"
        message={`Delete "${deleteDisc.payload?.reference}" permanently? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteOrder}
        onCancel={deleteDisc.close}
      />
    </>
  )
}