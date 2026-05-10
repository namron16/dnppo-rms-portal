'use client'
// app/admin/e-library/page.tsx (v3 — Drive Pool upload, Option A)

import { useState, useEffect, useCallback } from 'react'
import { PageHeader }            from '@/components/ui/PageHeader'
import { Badge }                 from '@/components/ui/Badge'
import { Button }                from '@/components/ui/Button'
import { SearchInput }           from '@/components/ui/SearchInput'
import { EmptyState }            from '@/components/ui/EmptyState'
import { ConfirmDialog }         from '@/components/ui/ConfirmDialog'
import { ToolbarSelect }         from '@/components/ui/Toolbar'
import { Modal }                 from '@/components/ui/Modal'
import { AddLibraryItemModal }   from '@/components/modals/AddLibraryItemModal'
import { useSearch, useModal, useDisclosure } from '@/hooks'
import { useRealtimeLibraryItems } from '@/hooks/useRealtimeCollections'
import { useToast }              from '@/components/ui/Toast'
import { Paperclip, Eye, PencilLine, Trash2, Download } from 'lucide-react'
import { logDeleteDocument, logEditLibraryItem, logViewDocument } from '@/lib/adminLogger'
import {
  getLibraryItems,
  updateLibraryItem,
  deleteLibraryItem,
  addArchivedDoc,
  archiveLibraryItem,
  getArchivedDocs,
} from '@/lib/data'
import { libraryBadgeClass }     from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import type { AdminRole } from '@/lib/auth'
import {
  canUploadDocuments, canEditDocuments, canDeleteDocuments, canArchiveDocuments,
} from '@/lib/permissions'
import { isDocumentUnrestricted } from '@/lib/rbac'
import type { LibraryItem, LibraryCategory } from '@/types'

type LibraryItemWithUrl = LibraryItem & { fileUrl?: string; description?: string }

// ── View Item Modal ───────────────────────────
function ViewItemModal({
  item,
  open,
  onClose,
  onPrint,
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
              <p className="text-[11px] font-semibold uppercase tracking-widests text-slate-400 mb-1">Added</p>
              <p className="text-xs text-slate-600">{item.dateAdded}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widests text-slate-400 mb-1">Size</p>
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
                <a
                  href={item.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md font-medium transition"
                >
                  {item.size === 'Link' ? '🔗 Open link' : '⬇ Download'}
                </a>
              </div>
            </div>
            {isPDF ? (
              <iframe src={item.fileUrl} title={item.title} className="w-full border-0" style={{ height: '500px' }} />
            ) : isImage ? (
              <img src={item.fileUrl} alt={item.title} className="w-full max-h-[500px] object-contain p-4" />
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <span className="text-4xl mb-3">📗</span>
                <p className="text-sm text-slate-500 mb-3">Preview not available for this file type.</p>
                <a
                  href={item.fileUrl}
                  download
                  className="inline-flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition"
                >
                  ⬇ Download to view
                </a>
              </div>
            )}
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

// ── Edit Library Item Modal ───────────────────
function EditLibraryItemModal({
  item,
  open,
  onClose,
  onSave,
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
          <input
            className={cls}
            value={form.title}
            onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Category</label>
            <select
              className={cls}
              value={form.category}
              onChange={e => setForm(prev => ({ ...prev, category: e.target.value as LibraryCategory }))}
            >
              <option value="MANUAL">Manual</option>
              <option value="GUIDELINE">Guideline</option>
              <option value="TEMPLATE">Template</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Date Added</label>
            <input
              type="date"
              className={cls}
              value={form.dateAdded}
              onChange={e => setForm(prev => ({ ...prev, dateAdded: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widests text-slate-500 mb-1.5">Description</label>
          <textarea
            rows={3}
            className={`${cls} resize-none`}
            value={form.description}
            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
          />
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

// ── Print helper ──────────────────────────────
async function printFileFromUrl(fileUrl: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right    = '0'
    iframe.style.bottom   = '0'
    iframe.style.width    = '0'
    iframe.style.height   = '0'
    iframe.style.border   = '0'
    iframe.style.opacity  = '0'

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

// ── Main Page ─────────────────────────────────
export default function LibraryPage() {
  const { toast }  = useToast()
  const { user }   = useAuth()

  const [items,   setItems]   = useState<LibraryItemWithUrl[]>([])
  const [loading, setLoading] = useState(true)
  const [catFilter, setCat]   = useState<LibraryCategory | 'ALL'>('ALL')

  useRealtimeLibraryItems(setItems as any)

  const canUploadLibrary = user?.permissions.canUpload ?? false
  const isSuperAdmin     = user?.role === 'P1'
  const canEdit          = user?.role ? canEditDocuments(user.role)   : false
  const canDelete        = user?.role ? canDeleteDocuments(user.role) : false
  const canArchive       = user?.role ? canArchiveDocuments(user.role): false

  const newModal    = useModal()
  const viewDisc    = useDisclosure<LibraryItemWithUrl>()
  const editDisc    = useDisclosure<LibraryItemWithUrl>()
  const archiveDisc = useDisclosure<LibraryItemWithUrl>()
  const deleteDisc  = useDisclosure<LibraryItemWithUrl>()

  const { query, setQuery, filtered: searched } = useSearch(
    items,
    ['title'] as Array<keyof LibraryItemWithUrl>
  )
  const filtered = searched.filter(i => catFilter === 'ALL' || i.category === catFilter)

  // ── Load items ──────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([getLibraryItems(), getArchivedDocs()]).then(([data, archived]) => {
      const archivedIds = new Set(
        (archived ?? [])
          .map((a: any) => String(a.id ?? ''))
          .filter((id: string) => id.startsWith('arc-lib-'))
          .map((id: string) => id.replace('arc-lib-', ''))
      )
      setItems((data as LibraryItemWithUrl[]).filter(item => !archivedIds.has(item.id)))
      setLoading(false)
    })
  }, [])

  // ── Called by AddLibraryItemModal via onAdd callback ────────────────────
  // The modal now handles the Drive upload AND the DB persist internally.
  // This function just appends the returned item to local state.
  function handleAdd(newItem: LibraryItemWithUrl) {
    if (!canUploadLibrary) {
      toast.error('Only P1–P10 accounts can add e-Library items.')
      return
    }
    setItems(prev => [newItem, ...prev])
  }

  async function handleArchive() {
    if (!canArchive) {
      toast.error('You do not have permission to archive e-Library items.')
      return
    }
    const item = archiveDisc.payload
    if (!item) return
    const today = new Date().toISOString().split('T')[0]
    await addArchivedDoc({
      id:           `arc-lib-${item.id}`,
      title:        item.title,
      type:         'Library Item',
      archivedDate: today,
      archivedBy:   'Admin',
    })
    await archiveLibraryItem(item.id)
    setItems(prev => prev.filter(i => i.id !== item.id))
    toast.success(`"${item.title}" has been archived.`)
    archiveDisc.close()
  }

  async function handleSave(updated: LibraryItemWithUrl) {
    if (!canEdit) {
      toast.error('You do not have permission to edit e-Library items.')
      return
    }
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
    if (!canDelete) {
      toast.error('You do not have permission to delete e-Library items.')
      return
    }
    await deleteLibraryItem(item.id)
    await logDeleteDocument(item.title, 'library item', user?.role as AdminRole)
    setItems(prev => prev.filter(i => i.id !== item.id))
    if (viewDisc.payload?.id === item.id) viewDisc.close()
    if (editDisc.payload?.id === item.id) editDisc.close()
    toast.success(`"${item.title}" deleted permanently.`)
    deleteDisc.close()
  }

  const handlePrintFile = useCallback(async (
    fileUrl: string,
    fileName: string,
    sourceDocumentId?: string,
  ) => {
    try {
      if (user && !isSuperAdmin) {
        if (!sourceDocumentId) {
          toast.error('Printing is only allowed for files approved by P1.')
          return
        }
        await isDocumentUnrestricted(sourceDocumentId, 'library')
      }
      await printFileFromUrl(fileUrl)
      toast.success(`Opened print preview for "${fileName}".`)
    } catch (error) {
      console.error('print error:', error)
      toast.error('Could not print the file.')
    }
  }, [user, isSuperAdmin, toast])

  const categoryStats = {
    ALL:       items.length,
    MANUAL:    items.filter(i => i.category === 'MANUAL').length,
    GUIDELINE: items.filter(i => i.category === 'GUIDELINE').length,
    TEMPLATE:  items.filter(i => i.category === 'TEMPLATE').length,
  }

  return (
    <>
      <PageHeader title="e-Library" />

      <div className="p-8 space-y-6">

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
        <div className="bg-white border-[1.5px] border-slate-200 rounded-xl overflow-hidden">

          <div className="flex items-center gap-2.5 px-6 py-4 border-b border-slate-100 bg-slate-50">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search library…"
              className="max-w-xs flex-1"
            />
            <ToolbarSelect
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setCat(e.target.value as LibraryCategory | 'ALL')
              }
            >
              <option value="ALL">All Categories</option>
              <option value="MANUAL">Manual</option>
              <option value="GUIDELINE">Guideline</option>
              <option value="TEMPLATE">Template</option>
            </ToolbarSelect>
            {canUploadLibrary && (
              <Button variant="primary" size="sm" className="ml-auto" onClick={newModal.open}>
                + Add to Library
              </Button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
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
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Title', 'Category', 'Size', 'Date Added', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => (
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
                        <div className="flex flex-col gap-0.5">
                          {item.created_at && (
                            <span className="text-xs">
                              📅 {new Date(item.created_at).toLocaleString('en-PH', {
                                year: 'numeric', month: 'short', day: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              viewDisc.open(item)
                              logViewDocument(item.title).catch(() => {})
                            }}
                            title="View item details"
                          >
                            <Eye size={16} className="text-slate-600" />
                          </Button>
                          {canEdit && (
                            <Button variant="ghost" size="sm" onClick={() => editDisc.open(item)} title="Edit item">
                              <PencilLine size={16} className="text-slate-600" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button variant="ghost" size="sm" onClick={() => deleteDisc.open(item)} title="Delete item">
                              <Trash2 size={16} className="text-slate-600" />
                            </Button>
                          )}
                          {item.fileUrl && (
                            <a href={item.fileUrl} download target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="sm" title="Download file">
                                <Download size={16} className="text-slate-600" />
                              </Button>
                            </a>
                          )}
                          {canArchive && (
                            <Button variant="ghost" size="sm" onClick={() => archiveDisc.open(item)} title="Archive item">
                              <span className="text-lg">🗄️</span>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}

      {/*
        Option A: using the migrated component from components/modals/AddLibraryItemModal.tsx
        The modal handles Drive upload + DB persist internally.
        onAdd receives the completed item and we append it to local state.
      */}
      {canUploadLibrary && (
        <AddLibraryItemModal
          open={newModal.isOpen}
          onClose={newModal.close}
          onAdd={handleAdd}
        />
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

      {canDelete && (
        <ConfirmDialog
          open={deleteDisc.isOpen}
          title="Delete Library Item"
          message={`Permanently delete "${deleteDisc.payload?.title}"? This action cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleDelete}
          onCancel={deleteDisc.close}
        />
      )}

      {canArchive && (
        <ConfirmDialog
          open={archiveDisc.isOpen}
          title="Archive Library Item"
          message={`Archive "${archiveDisc.payload?.title}"? It will be moved to the Archive page and can be restored from there.`}
          confirmLabel="Archive"
          variant="danger"
          onConfirm={handleArchive}
          onCancel={archiveDisc.close}
        />
      )}
    </>
  )
}