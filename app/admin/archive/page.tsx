'use client'
// app/admin/archive/page.tsx

import { useState, useEffect } from 'react'
import { PageHeader }    from '@/components/ui/PageHeader'
import { Badge }         from '@/components/ui/Badge'
import { Button }        from '@/components/ui/Button'
import { SearchInput }   from '@/components/ui/SearchInput'
import { EmptyState }    from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ToolbarSelect } from '@/components/ui/Toolbar'
import { Pagination }    from '@/components/ui/Pagination'
import { useSearch, useDisclosure, usePagination } from '@/hooks'
import { useRealtimeArchivedDocs } from '@/hooks/useRealtimeCollections'
import { useToast }      from '@/components/ui/Toast'
import { useAuth }       from '@/lib/auth'
import type { AdminRole } from '@/lib/auth'
import { logDeleteDocument } from '@/lib/adminLogger'
import { getArchivedDocs, deleteArchivedDoc, restoreArchivedDoc } from '@/lib/data'

interface ArchivedItem {
  id: string
  title: string
  type: string
  archivedDate: string
  archivedBy: string
}

export default function ArchivePage() {
  const { toast }    = useToast()
  const { user } = useAuth()
  const [items, setItems]     = useState<ArchivedItem[]>([])
  useRealtimeArchivedDocs(setItems)
  const [loading, setLoading] = useState(true)
  const [typeFilter, setType] = useState('All Types')
  const [isRestoring, setIsRestoring] = useState(false)

  const restoreDisc  = useDisclosure<ArchivedItem>()
  const deleteDisc   = useDisclosure<ArchivedItem>()

  const { query, setQuery, filtered: searched } = useSearch(items, ['title', 'archivedBy'] as Array<keyof ArchivedItem>)
  const filtered = searched.filter(i => typeFilter === 'All Types' || i.type === typeFilter)

  const {
    currentPage,
    pageSize,
    totalPages,
    paginatedItems,
    setCurrentPage,
    setPageSize,
  } = usePagination({
    items: filtered,
    defaultPageSize: 25,
    resetDeps: [query, typeFilter],
  })

  useEffect(() => {
    getArchivedDocs().then(data => {
      const mapped: ArchivedItem[] = data.map((d: any) => ({
        id:           d.id,
        title:        d.title,
        type:         d.type,
        archivedDate: d.archived_date ?? d.archivedDate ?? '',
        archivedBy:   d.archived_by  ?? d.archivedBy  ?? 'Admin',
      }))
      setItems(mapped)
      setLoading(false)
    })
  }, [])

  async function handleRestore() {
    const item = restoreDisc.payload
    if (!item) return
    setIsRestoring(true)
    try {
      await restoreArchivedDoc(item.id)
      setItems(prev => prev.filter(i => i.id !== item.id))
      toast.success(`"${item.title}" has been restored.`)
      restoreDisc.close()
    } finally {
      setIsRestoring(false)
    }
  }

  async function handleDelete() {
    const item = deleteDisc.payload
    if (!item) return
    await deleteArchivedDoc(item.id)
    await logDeleteDocument(item.title, `archived ${item.type.toLowerCase()}`)
    setItems(prev => prev.filter(i => i.id !== item.id))
    toast.success(`"${item.title}" permanently deleted.`)
    deleteDisc.close()
  }

  return (
    <>
      <PageHeader title="Archive" />

      <div className="p-8">
        <div className="bg-white border-[1.5px] border-slate-200 rounded-xl overflow-hidden">

          <div className="flex items-center gap-2.5 px-6 py-4 border-b border-slate-100 bg-slate-50">
            <SearchInput value={query} onChange={setQuery} placeholder="Search archived documents…" className="max-w-xs flex-1" />
            <ToolbarSelect onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setType(e.target.value)}>
              <option>All Types</option>
              <option>Special Order</option>
              <option>Classified Document</option>
              <option>Master Document</option>
              <option>Library Item</option>
            </ToolbarSelect>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState icon="🗄️" title="No archived documents found" description="Documents you archive will appear here." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['Document', 'Type', 'Archived Date', 'Archived By', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map(item => (
                      <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                        <td className="px-4 py-3.5 font-semibold text-sm text-slate-800">{item.title}</td>
                        <td className="px-4 py-3.5"><Badge className="bg-slate-200 text-slate-500">{item.type}</Badge></td>
                        <td className="px-4 py-3.5 text-sm text-slate-500">{item.archivedDate}</td>
                        <td className="px-4 py-3.5 text-sm text-slate-600">{item.archivedBy}</td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => restoreDisc.open(item)}>↩ Restore</Button>
                            <Button variant="ghost"   size="sm" onClick={() => deleteDisc.open(item)}>🗑</Button>
                          </div>
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
                  pageSizeOptions={[10, 25, 50]}
                />
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={restoreDisc.isOpen}
        title="Restore Document"
        message={`Restore "${restoreDisc.payload?.title}" to its original location?`}
        confirmLabel="Restore" variant="primary"
        isLoading={isRestoring}
        onConfirm={handleRestore}
        onCancel={restoreDisc.close}
      />
      <ConfirmDialog
        open={deleteDisc.isOpen}
        title="Permanently Delete"
        message={`Permanently delete "${deleteDisc.payload?.title}"? This cannot be undone.`}
        confirmLabel="Delete Forever" variant="danger"
        onConfirm={handleDelete}
        onCancel={deleteDisc.close}
      />
    </>
  )
}