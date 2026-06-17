'use client'
// app/admin/e-library/page.tsx
//
// FIX (upload access):
//   The "+ Add to Library" button and canUploadLibrary gate now use
//   canUploadDocuments() (P1–P10, WCPD, PPSMU) instead of the previous
//   P1-only permissions.canUpload check.
//
// FIX (per-user visibility):
//   loadAll filters library items by uploaded_by = user.role so each account
//   only sees the items they personally uploaded.
//   Privileged roles (admin, DPDA, DPDO) still see all items.

import { useState, useEffect, useCallback, useRef } from 'react'
import { PageHeader }            from '@/components/ui/PageHeader'
import { Badge }                 from '@/components/ui/Badge'
import { Button }                from '@/components/ui/Button'
import { SearchInput }           from '@/components/ui/SearchInput'
import { EmptyState }            from '@/components/ui/EmptyState'
import { ConfirmDialog }         from '@/components/ui/ConfirmDialog'
import { ToolbarSelect }         from '@/components/ui/Toolbar'
import { Modal }                 from '@/components/ui/Modal'
import { Pagination }            from '@/components/ui/Pagination'
import { AddLibraryItemModal }   from '@/components/modals/AddLibraryItemModal'
import { ForwardDocumentModal }  from '@/components/modals/ForwardDocumentModal'
import { useSearch, useModal, useDisclosure, usePagination } from '@/hooks'
import { useRealtimeLibraryItems } from '@/hooks/useRealtimeCollections'
import { useToast }              from '@/components/ui/Toast'
import { Eye, PencilLine, Trash2, Download, Paperclip, Share2, Archive, MoreHorizontal } from 'lucide-react'
import { logDeleteDocument, logEditLibraryItem, logAddLibraryItem, logArchiveLibraryItem } from '@/lib/adminLogger'
import {
  getLibraryItems,
  updateLibraryItem,
  deleteLibraryItem,
  addArchivedDoc,
  archiveLibraryItem,
  getArchivedDocs,
  deleteDriveFile,
} from '@/lib/data'
import { libraryBadgeClass }     from '@/lib/utils'
import { useAuth }               from '@/lib/auth'
import type { AdminRole }        from '@/lib/auth'
import {
  canUploadDocuments, canEditDocuments, canDeleteDocuments, canArchiveDocuments,
} from '@/lib/permissions'
import { isDocumentUnrestricted } from '@/lib/rbac'
import type { LibraryItem, LibraryCategory, LibraryItemWithUrl } from '@/types'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

// ── Privileged roles that see ALL items regardless of uploader ────────────────
const PRIVILEGED_ROLES = ['admin', 'DPDA', 'DPDO']
function canSeeAllDocuments(role: string): boolean {
  return PRIVILEGED_ROLES.includes(role)
}

// ── Action Menu ───────────────────────────────────────────────────────────────

function ActionMenu({
  item,
  canEdit,
  canDelete,
  canArchive,
  canForward,
  onView,
  onEdit,
  onDelete,
  onArchive,
  onForward,
}: {
  item: LibraryItemWithUrl
  canEdit: boolean
  canDelete: boolean
  canArchive: boolean
  canForward: boolean
  onView: () => void
  onEdit: () => void
  onDelete: () => void
  onArchive: () => void
  onForward: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const menuItem = (label: string, icon: React.ReactNode, onClick: () => void, danger = false) => (
    <button
      onClick={() => { onClick(); setOpen(false) }}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors text-left
        ${danger
          ? 'text-red-600 hover:bg-red-50'
          : 'text-slate-700 hover:bg-slate-50'}`}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(v => !v)}
        title="Actions"
        className="h-8 w-8 p-0 flex items-center justify-center"
      >
        <MoreHorizontal size={16} className="text-slate-500" />
      </Button>

      {open && (
        <div className="absolute right-0 top-9 z-50 w-44 rounded-xl border border-slate-200 bg-white shadow-lg py-1.5 px-1">
          {menuItem('View', <Eye size={14} />, onView)}
          {item.fileUrl && menuItem(
            'Download',
            <Download size={14} />,
            () => window.open(item.fileUrl, '_blank')
          )}
          {canForward && menuItem('Forward', <Share2 size={14} />, onForward)}
          {canEdit && menuItem('Edit', <PencilLine size={14} />, onEdit)}
          {(canArchive || canDelete) && (
            <div className="my-1 border-t border-slate-100" />
          )}
          {canArchive && menuItem('Archive', <Archive size={14} />, onArchive, true)}
          {canDelete  && menuItem('Delete',  <Trash2  size={14} />, onDelete,  true)}
        </div>
      )}
    </div>
  )
}

// ── View Item Modal ───────────────────────────────────────────────────────────

function ViewItemModal({
  item, open, onClose, onPrint,
}: {
  item: LibraryItemWithUrl | null
  open: boolean
  onClose: () => void
  onPrint: (fileUrl: string, fileName: string, sourceDocumentId?: string) => void
}) {
  if (!item) return null

  const isPDF   = !!item.fileUrl?.match(/\.pdf(\?|$)/i)
  const isImage = !!item.fileUrl?.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)

  return (
    <Modal open={open} onClose={onClose} title="Library Item" width="max-w-4xl">
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Title</p>
            <p className="text-sm font-bold text-slate-800">{item.title}</p>
            {item.description && (
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.description}</p>
            )}
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Category</p>
              <Badge className={libraryBadgeClass(item.category)}>{item.category}</Badge>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Added</p>
              <p className="text-xs text-slate-600">{item.dateAdded}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Size</p>
              <p className="text-xs text-slate-600">{item.size}</p>
            </div>
          </div>
        </div>

        {item.fileUrl ? (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Document Preview</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => onPrint(item.fileUrl!, item.title, item.id)}
                  className="text-xs px-2.5 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded-md font-medium transition"
                >
                  🖨️ Print
                </button>
                <a href={item.fileUrl} target="_blank" rel="noopener noreferrer"
                  className="text-xs px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md font-medium transition">
                    🔗 Open File
                </a>
              </div>
            </div>
            <div className="flex flex-col items-center justify-center py-10 text-center bg-slate-50">
            <span className="text-4xl mb-3">📄</span>
            <p className="text-sm text-slate-500 mb-3">Click "Open file" to view in a new tab.</p>
          </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 bg-slate-50 border border-slate-200 rounded-xl text-center">
          <span className="text-3xl mb-2">📗</span>
          <p className="text-sm text-slate-400">No file attached to this library item.</p>
        </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Edit Library Item Modal ───────────────────────────────────────────────────

function EditLibraryItemModal({
  item, open, onClose, onSave,
}: {
  item: LibraryItemWithUrl | null
  open: boolean
  onClose: () => void
  onSave: (updated: LibraryItemWithUrl) => Promise<void>
}) {
  const [form, setForm] = useState({
    title:       '',
    category:    'MANUAL' as LibraryCategory,
    description: '',
    dateAdded:   '',
  })

  useEffect(() => {
    if (!item || !open) return
    setForm({
      title:       item.title,
      category:    item.category,
      description: item.description ?? '',
      dateAdded:   item.dateAdded,
    })
  }, [item, open])

  if (!item) return null

  const cls = 'w-full px-3 py-2.5 border-[1.5px] border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition'

  return (
    <Modal open={open} onClose={onClose} title="Edit Library Item" width="max-w-lg">
      <div className="p-6 space-y-4">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Title</label>
          <input className={cls} value={form.title} onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Category</label>
            <select className={cls} value={form.category} onChange={e => setForm(prev => ({ ...prev, category: e.target.value as LibraryCategory }))}>
              <option value="MANUAL">Manual</option>
              <option value="GUIDELINE">Guideline</option>
              <option value="TEMPLATE">Template</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Date Added</label>
            <input type="date" className={cls} value={form.dateAdded} onChange={e => setForm(prev => ({ ...prev, dateAdded: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Description</label>
          <textarea rows={3} className={`${cls} resize-none`} value={form.description}
            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} />
        </div>
        <div className="flex justify-end gap-2.5 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onSave({
              ...item,
              title:       form.title.trim(),
              category:    form.category,
              description: form.description.trim() || undefined,
              dateAdded:   form.dateAdded,
              created_at:  item.created_at,
            })}
            disabled={!form.title.trim() || !form.dateAdded}
          >
            💾 Save Changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Print helper ──────────────────────────────────────────────────────────────

async function printFileFromUrl(fileUrl: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement('iframe')
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0' })

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
      .then(r => { if (!r.ok) throw new Error(`Fetch failed: ${r.status}`); return r.blob() })
      .then(blob => {
        blobUrl = URL.createObjectURL(blob)
        iframe.src = blobUrl
        iframe.onload = () => {
          const target = iframe.contentWindow
          if (!target) { finish(() => { cleanup(); reject(new Error('Unable to load content.')) }); return }
          window.setTimeout(() => {
            finish(() => {
              try { target.focus(); target.print(); resolve() }
              catch (e) { reject(e instanceof Error ? e : new Error('Print failed.')) }
              finally { window.setTimeout(cleanup, 1200) }
            })
          }, 500)
        }
        iframe.onerror = () => finish(() => { cleanup(); reject(new Error('Could not load file.')) })
        document.body.appendChild(iframe)
      })
      .catch(e => finish(() => { cleanup(); reject(e instanceof Error ? e : new Error('Fetch failed.')) }))
  })
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const { toast }  = useToast()
  const { user }   = useAuth()

  const [items,   setItems]   = useState<LibraryItemWithUrl[]>([])
  const [loading, setLoading] = useState(true)
  const [catFilter, setCat]   = useState<LibraryCategory | 'ALL'>('ALL')
  const [isArchiving, setIsArchiving] = useState(false)
  const [isDeleting,  setIsDeleting]  = useState(false)

  useRealtimeLibraryItems(setItems as any)

  // FIX: use canUploadDocuments (P1–P10, WCPD, PPSMU) instead of P1-only check
  const canUploadLibrary = user?.role ? canUploadDocuments(user.role as AdminRole) : false
  const canEdit          = user?.role ? canEditDocuments(user.role as AdminRole)    : false
  const canDelete        = user?.role ? canDeleteDocuments(user.role as AdminRole)  : false
  const canArchive       = user?.role ? canArchiveDocuments(user.role as AdminRole) : false
  const canForward       = canUploadLibrary

  const newModal      = useModal()
  const viewDisc      = useDisclosure<LibraryItemWithUrl>()
  const editDisc      = useDisclosure<LibraryItemWithUrl>()
  const archiveDisc   = useDisclosure<LibraryItemWithUrl>()
  const deleteDisc    = useDisclosure<LibraryItemWithUrl>()
  const forwardDisc   = useDisclosure<LibraryItemWithUrl>()

  const attachmentsMap = new Map<string, any[]>()

  const { query, setQuery, filtered: searched } = useSearch(
    items,
    ['title'] as Array<keyof LibraryItemWithUrl>
  )
  const filtered = searched.filter(i => catFilter === 'ALL' || i.category === catFilter)

  const {
    currentPage, pageSize, totalPages, paginatedItems, setCurrentPage, setPageSize,
  } = usePagination({ items: filtered, defaultPageSize: 25, resetDeps: [query, catFilter] })

  // ── Load — filter by uploaded_by unless user is privileged ────────────────
  useEffect(() => {
    if (!user) return
    Promise.all([getLibraryItems(), getArchivedDocs()]).then(([data, archived]) => {
      const archivedIds = new Set(
        (archived ?? [])
          .map((a: any) => String(a.id ?? ''))
          .filter((id: string) => id.startsWith('arc-lib-'))
          .map((id: string) => id.replace('arc-lib-', ''))
      )
      // Privileged roles see all; everyone else sees only their own uploads.
      const visible = (data as LibraryItemWithUrl[]).filter(item => {
        if (archivedIds.has(item.id)) return false
        if (canSeeAllDocuments(user.role)) return true
        return !item.uploaded_by || item.uploaded_by === user.role
      })
      setItems(visible)
      setLoading(false)
    })
  }, [user])

  function handleAdd(newItem: LibraryItemWithUrl) {
    if (!canUploadLibrary) { toast.error('You do not have permission to add e-Library items.'); return }
    setItems(prev => [newItem, ...prev])
  }

  async function handleArchive() {
    if (!canArchive) { toast.error('You do not have permission to archive e-Library items.'); return }
    const item = archiveDisc.payload
    if (!item) return
    setIsArchiving(true)
    try {
      // Step 1: Move file in Google Drive to the archive folder
      const gdriveFileId  = item.gdrive_file_id
      const poolAccountId = item.pool_account_id

      if (gdriveFileId && poolAccountId) {
        const res = await fetch('/api/gdrive/archive', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gdriveFileId,
            poolAccountId,
            category: 'library_items',
          }),
        })

        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          toast.error(json.error ?? 'Could not move file to the archive. Please try again.')
        }
      }

      // Step 2: Add to archived_docs table
      const today = new Date().toISOString().split('T')[0]
      await addArchivedDoc({ 
        id: `arc-lib-${item.id}`, 
        title: item.title, 
        type: 'Library Item', 
        archivedDate: today, 
        archivedBy: user?.role ?? 'P1',
      })

      // Step 3: Mark as archived
      await archiveLibraryItem(item.id)
      await logArchiveLibraryItem(item.title)

      // Step 4: Remove from UI
      setItems(prev => prev.filter(i => i.id !== item.id))
      toast.success(`"${item.title}" has been archived.`)
      archiveDisc.close()
    } finally {
      setIsArchiving(false)
    }
  }

  async function handleSave(updated: LibraryItemWithUrl) {
    if (!canEdit) { toast.error('You do not have permission to edit e-Library items.'); return }
    await updateLibraryItem(updated)
    await logEditLibraryItem(updated.title)
    setItems(prev => prev.map(item => item.id === updated.id ? updated : item))
    if (viewDisc.payload?.id === updated.id) viewDisc.open(updated)
    toast.success('Library item updated.')
    editDisc.close()
  }

  async function handleDelete() {
  const item = deleteDisc.payload
  if (!item) return
  if (!canDelete) { toast.error('You do not have permission to delete e-Library items.'); return }
  setIsDeleting(true)
  try {
    await deleteDriveFile(item.gdrive_file_id, item.pool_account_id)
    await deleteLibraryItem(item.id)
    await logDeleteDocument(item.title, 'library item')
    setItems(prev => prev.filter(i => i.id !== item.id))
    if (viewDisc.payload?.id === item.id) viewDisc.close()
    if (editDisc.payload?.id === item.id) editDisc.close()
    toast.success(`"${item.title}" deleted permanently.`)
    deleteDisc.close()
  } catch (err: any) {
      toast.error(err?.message ?? 'Could not delete file from Google Drive. Please try again.')
      return
    }
    finally {
    setIsDeleting(false)
  }
}

  const handlePrintFile = useCallback(async (fileUrl: string, fileName: string, sourceDocumentId?: string) => {
    try {
      await printFileFromUrl(fileUrl)
      toast.success(`Opened print preview for "${fileName}".`)
    } catch (error) {
      console.error('print error:', error)
      toast.error('Could not print the file.')
    }
  }, [toast])

  const categoryStats = {
    ALL:       items.length,
    MANUAL:    items.filter(i => i.category === 'MANUAL').length,
    GUIDELINE: items.filter(i => i.category === 'GUIDELINE').length,
    TEMPLATE:  items.filter(i => i.category === 'TEMPLATE').length,
  }

  const forwardPayload = forwardDisc.payload
    ? {
        id:            forwardDisc.payload.id,
        title:         forwardDisc.payload.title,
        type:          `Library · ${forwardDisc.payload.category}`,
        documentType:  'library' as const,
        gdriveFileId:  forwardDisc.payload.gdrive_file_id ?? '',
        gdriveUrl:     forwardDisc.payload.fileUrl ?? '',
        poolAccountId: forwardDisc.payload.pool_account_id ?? '',
        fileName:      forwardDisc.payload.title,
        fileSizeBytes: forwardDisc.payload.file_size_bytes,
        mimeType:      forwardDisc.payload.mime_type,
      }
    : null

      // right after your existing hooks, before the main return
    if (loading) {
      return (
        <>
          <PageHeader title="e-Library" />
          <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 56px)' }}>
            <LoadingSpinner size="lg" />
          </div>
        </>
      )
    }

  return (
    <>
      <PageHeader title="e-Library" />

      <div className="flex h-full min-h-0 flex-col gap-6 p-8">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'All Items',  value: categoryStats.ALL,       icon: '📚', bg: 'bg-blue-50',   txt: 'text-blue-700'   },
            { label: 'Manuals',    value: categoryStats.MANUAL,    icon: '📖', bg: 'bg-amber-50',  txt: 'text-amber-700'  },
            { label: 'Guidelines', value: categoryStats.GUIDELINE, icon: '📋', bg: 'bg-violet-50', txt: 'text-violet-700' },
            { label: 'Templates',  value: categoryStats.TEMPLATE,  icon: '📄', bg: 'bg-sky-50',    txt: 'text-sky-700'    },
          ].map(s => (
            <div key={s.label} className={`${s.bg} border border-slate-200 rounded-xl px-5 py-4 flex items-center gap-3`}>
              <span className="text-2xl">{s.icon}</span>
              <div>
                <div className={`text-2xl font-extrabold ${s.txt}`}>{s.value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Main table */}
        <div className="bg-white border-[1.5px] border-slate-200 rounded-xl overflow-visible flex flex-1 min-h-0 flex-col">
          <div className="flex items-center gap-2.5 px-6 py-4 border-b border-slate-100 bg-slate-50">
            <SearchInput value={query} onChange={setQuery} placeholder="Search library…" className="max-w-xs flex-1" />
            <ToolbarSelect onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCat(e.target.value as LibraryCategory | 'ALL')}>
              <option value="ALL">All Categories</option>
              <option value="MANUAL">Manual</option>
              <option value="GUIDELINE">Guideline</option>
              <option value="TEMPLATE">Template</option>
            </ToolbarSelect>
            {/* FIX: Show "+ Add to Library" for all allowed roles (P1–P10, WCPD, PPSMU) */}
            {canUploadLibrary && (
              <Button variant="primary" size="sm" className="ml-auto" onClick={newModal.open}>
                + Add to Library
              </Button>
            )}
          </div>

          {loading ? (
            <div className="flex flex-1 items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-1 min-h-0 items-center justify-center py-16">
              <EmptyState
                icon="📚"
                title="No items found"
                description={
                  query || catFilter !== 'ALL'
                    ? 'Try adjusting your search or category filter.'
                    : 'Add your first library item to get started.'
                }
                action={
                  !query && catFilter === 'ALL' && canUploadLibrary
                    ? <Button variant="primary" size="sm" onClick={newModal.open}>+ Add to Library</Button>
                    : undefined
                }
              />
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['Title', 'Category', 'Size', 'Date Added', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map(item => (
                      <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <span>📗</span>
                            <span className="font-semibold text-sm text-slate-800">{item.title}</span>
                            {item.fileUrl && (
                              <span className="inline-flex items-center bg-emerald-50 text-emerald-600 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-emerald-200">
                                <Paperclip size={11} />
                              </span>
                            )}
                          </div>
                          {item.description && (
                            <p className="text-xs text-slate-400 mt-0.5 ml-6 truncate max-w-xs">{item.description}</p>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge className={libraryBadgeClass(item.category)}>{item.category}</Badge>
                        </td>
                        <td className="px-4 py-3.5 text-sm text-slate-500">{item.size}</td>
                        <td className="px-4 py-3.5 text-sm text-slate-500">
                          {item.created_at && (
                            <span className="text-xs">
                              📅 {new Date(item.created_at).toLocaleString('en-PH', {
                                year: 'numeric', month: 'short', day: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <ActionMenu
                            item={item}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            canArchive={canArchive}
                            canForward={canForward}
                            onView={() => viewDisc.open(item)}
                            onEdit={() => editDisc.open(item)}
                            onDelete={() => deleteDisc.open(item)}
                            onArchive={() => archiveDisc.open(item)}
                            onForward={() => forwardDisc.open(item)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!loading && filtered.length > 0 && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={filtered.length}
                  pageSize={pageSize}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={setPageSize}
                  pageSizeOptions={[10, 25, 50, 100]}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      {canUploadLibrary && (
        <AddLibraryItemModal open={newModal.isOpen} onClose={newModal.close} onAdd={handleAdd} />
      )}

      <ViewItemModal
        item={viewDisc.payload ?? null}
        open={viewDisc.isOpen}
        onClose={viewDisc.close}
        onPrint={handlePrintFile}
      />

      {canEdit && (
        <EditLibraryItemModal
          item={editDisc.payload ?? null}
          open={editDisc.isOpen}
          onClose={editDisc.close}
          onSave={handleSave}
        />
      )}

      {canForward && forwardPayload && user && (
        <ForwardDocumentModal
          open={forwardDisc.isOpen}
          onClose={forwardDisc.close}
          document={forwardPayload}
          attachmentsMap={attachmentsMap}
          senderRole={user.role as AdminRole}
          onForwarded={() => toast.success(`"${forwardPayload.title}" forwarded successfully.`)}
        />
      )}

      {canDelete && (
        <ConfirmDialog
          open={deleteDisc.isOpen}
          title="Delete Library Item"
          message={`Permanently delete "${deleteDisc.payload?.title}"? This action cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          isLoading={isDeleting}        // ← add
          onConfirm={handleDelete}
          onCancel={deleteDisc.close}
        />
      )}

      {canArchive && (
        <ConfirmDialog
          open={archiveDisc.isOpen}
          title="Archive Library Item"
          message={`Archive "${archiveDisc.payload?.title}"? It will be moved to the Archive page.`}
          confirmLabel="Archive" variant="danger"
          isLoading={isArchiving}
          onConfirm={handleArchive}
          onCancel={archiveDisc.close}
        />
      )}
    </>
  )
}