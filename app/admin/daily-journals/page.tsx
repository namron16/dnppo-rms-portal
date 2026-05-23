'use client'
// app/admin/daily-journals/page.tsx
// FIX: handleCreate now persists uploaded_by on the journal entry.
//      loadAll filters by user.role so each account only sees their own entries.
//      DPDA, DPDO, and admin are privileged roles that see all entries.

import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/SearchInput'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { ToolbarSelect } from '@/components/ui/Toolbar'
import { useToast } from '@/components/ui/Toast'
import { AddJournalEntryModal } from '@/components/modals/AddJournalEntryModal'
import { useDisclosure, useModal, useSearch, usePagination } from '@/hooks'
import { useRealtimeDailyJournals } from '@/hooks/useRealtimeCollections'
import { logDeleteDocument, logEditJournal, logViewDocument, logCreateJournal, logArchiveJournal } from '@/lib/adminLogger'
import { useAuth } from '@/lib/auth'
import type { AddJournalEntryInput } from '@/lib/validations'
import type { JournalEntry } from '@/types'
import {
  addArchivedDoc,
  addDailyJournal,
  archiveDailyJournal,
  deleteDailyJournal,
  getDailyJournals,
  updateDailyJournal,
  type DailyJournalRecord,
} from '@/lib/data'
import {
  canUploadDocuments, canEditDocuments, canDeleteDocuments, canArchiveDocuments,
} from '@/lib/permissions'

// ── Privileged roles that can see ALL entries regardless of uploader ─────────
// FIX: DPDA, DPDO, and admin see everything; all other roles see only their own.
const PRIVILEGED_ROLES = ['admin', 'DPDA', 'DPDO']
function canSeeAllDocuments(role: string): boolean {
  return PRIVILEGED_ROLES.includes(role)
}

type JournalStatus = 'Draft' | 'Filed' | 'Reviewed'

type JournalRecord = DailyJournalRecord & {
  content: string
  summary: string
  status: JournalStatus
  uploaded_by?: string   // FIX: track who created this entry
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(value: string | undefined) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-PH', {
    month: 'short', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function typeBadgeClass(type: JournalEntry['type']) {
  switch (type) {
    case 'MEMO':   return 'bg-blue-50 text-blue-700 border border-blue-200'
    case 'REPORT': return 'bg-amber-50 text-amber-700 border border-amber-200'
    case 'LOG':    return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    default:       return 'bg-slate-50 text-slate-700 border border-slate-200'
  }
}

function statusBadgeClass(status: JournalStatus) {
  switch (status) {
    case 'Draft':    return 'bg-slate-100 text-slate-600 border border-slate-200'
    case 'Filed':    return 'bg-sky-50 text-sky-700 border border-sky-200'
    case 'Reviewed': return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    default:         return 'bg-slate-100 text-slate-600 border border-slate-200'
  }
}

// ── View Journal Modal ──────────────────────────────────────────────────────

function ViewJournalModal({
  entry, open, onClose, onViewAttachment,
}: {
  entry: JournalRecord | null
  open: boolean
  onClose: () => void
  onViewAttachment: (fileUrl: string, fileName: string) => void
}) {
  if (!entry) return null

  return (
    <Modal open={open} onClose={onClose} title="Journal Entry" width="max-w-4xl">
      <div className="p-6 space-y-4">
        <div className="grid gap-3 md:grid-cols-[1.5fr_1fr]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Title</p>
            <p className="text-sm font-bold text-slate-800">{entry.title}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{entry.summary}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Type</p>
              <Badge className={typeBadgeClass(entry.type)}>{entry.type}</Badge>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Status</p>
              <Badge className={statusBadgeClass(entry.status)}>{entry.status}</Badge>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Author</p>
              <p className="font-semibold text-slate-700">{entry.author}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Date</p>
              <p className="font-semibold text-slate-700">{formatDate(entry.date)}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entry Content</span>
            <span className="text-xs text-slate-400">
              {entry.attachments} attachment{entry.attachments === 1 ? '' : 's'}
            </span>
          </div>
          <div className="p-4 bg-white">
            <p className="text-sm leading-7 text-slate-600 whitespace-pre-wrap">{entry.content}</p>
          </div>
        </div>

        {entry.fileUrl && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Attachment</p>
              <p className="text-sm font-semibold text-slate-800">Journal attachment</p>
            </div>
            <Button variant="outline" onClick={() => onViewAttachment(entry.fileUrl!, entry.title)}>
              View File
            </Button>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── View Attachment Modal ───────────────────────────────────────────────────

function ViewJournalAttachmentModal({
  fileUrl, fileName, open, onClose,
}: {
  fileUrl: string
  fileName: string
  open: boolean
  onClose: () => void
}) {
  const isImage  = !!fileUrl.match(/\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?|$)/i)
  const isPDF    = !!fileUrl.match(/\.pdf(\?|$)/i)
  const isOffice = !!fileUrl.match(/\.(doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp)(\?|$)/i)
  const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`

  return (
    <Modal open={open} onClose={onClose} title={`Viewing: ${fileName}`} width="max-w-5xl">
      <div className="p-6 space-y-4">
        {isImage ? (
          <div className="flex justify-center rounded-xl border border-slate-200 bg-white p-4">
            <img src={fileUrl} alt={fileName} className="max-h-[75vh] max-w-full object-contain rounded-lg" />
          </div>
        ) : isPDF ? (
          <iframe src={fileUrl} title={fileName} className="w-full border-0" style={{ height: '75vh', minHeight: 400 }} />
        ) : isOffice ? (
          <div className="flex justify-center rounded-xl border border-slate-200 bg-white p-4">
            <iframe src={officeViewerUrl} title={fileName} className="w-full border-0 rounded-lg" style={{ height: '75vh', minHeight: 400 }} />
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <p className="font-medium text-slate-800 mb-2">Preview not available for this file type.</p>
            <a href={fileUrl} download className="text-blue-700 font-semibold hover:underline">Download file</a>
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Page
// ══════════════════════════════════════════════════════════════════════════════

export default function DailyJournalsPage() {
  const { toast } = useToast()
  const { user }  = useAuth()
  const isSuperAdmin = user?.role === 'P1'

  const canUpload  = user?.role ? canUploadDocuments(user.role)  : false
  const canEdit    = user?.role ? canEditDocuments(user.role)    : false
  const canDelete  = user?.role ? canDeleteDocuments(user.role)  : false
  const canArchive = user?.role ? canArchiveDocuments(user.role) : false

  const addModal            = useModal()
  const editDisc            = useDisclosure<JournalRecord>()
  const viewDisc            = useDisclosure<JournalRecord>()
  const viewAttachmentDisc  = useDisclosure<{ fileUrl: string; fileName: string }>()
  const archiveDisc         = useDisclosure<JournalRecord>()
  const deleteDisc          = useDisclosure<JournalRecord>()

  const [loading, setLoading]   = useState(true)
  const [entries, setEntries]   = useState<JournalRecord[]>([])
  const [activeType, setActiveType] = useState<'ALL' | JournalEntry['type']>('ALL')

  useRealtimeDailyJournals(setEntries)

  const { query, setQuery, filtered: searched } = useSearch(
    entries,
    ['title', 'author', 'content'] as Array<keyof JournalRecord>
  )

  const filteredEntries = useMemo(
    () => searched.filter(e => activeType === 'ALL' || e.type === activeType),
    [activeType, searched]
  )

  const {
    currentPage,
    pageSize,
    totalPages,
    paginatedItems,
    setCurrentPage,
    setPageSize,
  } = usePagination({
    items: filteredEntries,
    defaultPageSize: 20,
    resetDeps: [query, activeType],
  })

  const journalStats = useMemo(() => ({
    all:    entries.length,
    memo:   entries.filter(e => e.type === 'MEMO').length,
    report: entries.filter(e => e.type === 'REPORT').length,
    log:    entries.filter(e => e.type === 'LOG').length,
  }), [entries])

  // ── Load — FIX: filter by uploaded_by unless user is privileged ──────────
  useEffect(() => {
    const role = user?.role ?? ''
    if (!role) return
    let isMounted = true
    async function load() {
      try {
        const data = await getDailyJournals()
        if (!isMounted) return

        // FIX: privileged roles see all entries; everyone else sees only their own.
        const visible = data.filter((entry: any) => {
          if (canSeeAllDocuments(role)) return true       // privileged: see all
          return !entry.uploaded_by || entry.uploaded_by === role
          //      ↑ `!entry.uploaded_by` keeps legacy records visible during migration
        })

        setEntries(visible.map((entry: any) => ({
          ...entry,
          content:     entry.content ?? 'No content was provided for this entry.',
          summary:     entry.summary ?? (entry.content?.slice(0, 120) || 'No summary available.'),
          status:      (entry.status ?? 'Draft') as JournalStatus,
          attachments: entry.fileUrl ? Math.max(entry.attachments ?? 0, 1) : (entry.attachments ?? 0),
        })))
      } catch (error) {
        if (!isMounted) return
        toast.error(error instanceof Error ? error.message : 'Failed to load daily journals.')
      } finally {
        if (isMounted) setLoading(false)
      }
    }
    load()
    return () => { isMounted = false }
  }, [user?.role]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Create — FIX: persist uploaded_by on new entry ──────────────────────
  async function handleCreate(
    input: AddJournalEntryInput & { file?: File; driveFileUrl?: string; uploaded_by?: string }
  ) {
    if (!canUpload) throw new Error('You do not have permission to create journal entries.')

    if (!input.file && !input.driveFileUrl) {
      throw new Error('Attachment is required.')
    }

    const now    = new Date()
    const status: JournalStatus =
      input.type === 'MEMO'   ? 'Draft'
      : input.type === 'REPORT' ? 'Reviewed'
      : 'Filed'

    // FIX: store uploaded_by so the page can filter entries per user
    const nextEntry: JournalRecord = {
      id:          `jrnl-${Date.now()}`,
      title:       input.title.trim(),
      type:        input.type,
      author:      input.author.trim(),
      date:        input.date || now.toISOString().split('T')[0],
      content:     input.content?.trim() || 'No content was provided for this entry.',
      fileUrl:     input.driveFileUrl,
      status,
      attachments: input.driveFileUrl ? 1 : 0,
      summary:     input.content?.trim()
        ? input.content.trim().slice(0, 120)
        : 'Newly created entry waiting for final review.',
      uploaded_by: input.uploaded_by ?? user?.role,   // FIX
    }

    await addDailyJournal(nextEntry)
    await logCreateJournal(nextEntry.title)
    setEntries(prev => [nextEntry, ...prev])
    addModal.close()
  }

  // ── Edit — FIX: preserve uploaded_by when updating ──────────────────────
  async function handleEdit(
    input: AddJournalEntryInput & { file?: File; driveFileUrl?: string; uploaded_by?: string }
  ) {
    if (!canEdit) throw new Error('You do not have permission to edit journal entries.')

    const existing = editDisc.payload
    if (!existing) return

    const nextFileUrl = input.driveFileUrl ?? existing.fileUrl

    // FIX: preserve the original uploaded_by — editing doesn't change ownership
    const updatedEntry: JournalRecord = {
      ...existing,
      title:       input.title.trim(),
      type:        input.type,
      author:      input.author.trim(),
      date:        input.date,
      content:     input.content?.trim() || 'No content was provided for this entry.',
      fileUrl:     nextFileUrl,
      attachments: nextFileUrl ? 1 : 0,
      summary:     input.content?.trim()
        ? input.content.trim().slice(0, 120)
        : 'Updated journal entry.',
      status:
        input.type === 'MEMO'   ? 'Draft'
        : input.type === 'REPORT' ? 'Reviewed'
        : 'Filed',
      uploaded_by: existing.uploaded_by,   // FIX: keep original owner
    }

    await updateDailyJournal(updatedEntry)
    await logEditJournal(updatedEntry.title)
    setEntries(prev => prev.map(e => e.id === updatedEntry.id ? updatedEntry : e))
    if (viewDisc.payload?.id === updatedEntry.id) viewDisc.open(updatedEntry)
    editDisc.close()
  }

  // ── Archive ────────────────────────────────────────────────────────────────
  async function handleArchive() {
    if (!canArchive) { toast.error('You do not have permission to archive journal entries.'); return }
    const item = archiveDisc.payload
    if (!item) return
    const today = new Date().toISOString().split('T')[0]
    await archiveDailyJournal(item.id)
    await addArchivedDoc({ id: `arc-dj-${item.id}`, title: item.title, type: 'Daily Journal', archivedDate: today, archivedBy: 'Admin' })
    await logArchiveJournal(item.title)
    setEntries(prev => prev.filter(e => e.id !== item.id))
    if (viewDisc.payload?.id === item.id) viewDisc.close()
    archiveDisc.close()
    toast.success(`"${item.title}" has been archived.`)
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete() {
    const item = deleteDisc.payload
    if (!item) return
    if (!canDelete) { toast.error('You do not have permission to delete journal entries.'); return }
    await deleteDailyJournal(item.id)
    await logDeleteDocument(item.title, 'daily journal')
    setEntries(prev => prev.filter(e => e.id !== item.id))
    if (viewDisc.payload?.id  === item.id) viewDisc.close()
    if (editDisc.payload?.id  === item.id) editDisc.close()
    deleteDisc.close()
    toast.success(`"${item.title}" deleted permanently.`)
  }

  return (
    <>
      <PageHeader title="Daily Journals" />

      <div className="p-8 space-y-6">

        {/* Hero section */}
        <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.02),rgba(14,165,233,0.06))]" />
          <div className="relative grid gap-6 p-6 lg:grid-cols-[1.4fr_1fr] lg:p-7">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Operations logbook</p>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">Daily Journal Register</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                Review daily memos, reports, and logs in a clean register. Use the filters to
                narrow the list and open any entry for a detailed view.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">Searchable register</span>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Tabbed entry types</span>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Quick add modal</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 self-start">
              {[
                { label: 'Total Entries', value: journalStats.all,    icon: '📒', bg: 'bg-blue-50',   text: 'text-blue-700'   },
                { label: 'Memos',         value: journalStats.memo,   icon: '📝', bg: 'bg-amber-50',  text: 'text-amber-700'  },
                { label: 'Reports',       value: journalStats.report, icon: '📋', bg: 'bg-violet-50', text: 'text-violet-700' },
                { label: 'Logs',          value: journalStats.log,    icon: '🗂️', bg: 'bg-emerald-50',text: 'text-emerald-700'},
              ].map(card => (
                <div key={card.label} className={`${card.bg} rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3`}>
                  <span className="text-2xl">{card.icon}</span>
                  <div>
                    <div className={`text-2xl font-extrabold ${card.text}`}>{card.value}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{card.label}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Table */}
        <div className="bg-white border-[1.5px] border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2.5 px-6 py-4 border-b border-slate-100 bg-slate-50 flex-wrap">
            <SearchInput value={query} onChange={setQuery} placeholder="Search journal entries…" className="max-w-xs flex-1" />
            <ToolbarSelect value={activeType} onChange={e => setActiveType(e.target.value as 'ALL' | JournalEntry['type'])}>
              <option value="ALL">All Types</option>
              <option value="MEMO">Memo</option>
              <option value="REPORT">Report</option>
              <option value="LOG">Log</option>
            </ToolbarSelect>
            {isSuperAdmin && (
              <Button variant="primary" size="sm" className="ml-auto" onClick={addModal.open}>
                + Add Entry
              </Button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredEntries.length === 0 ? (
            <EmptyState
              icon="📒"
              title="No journal entries found"
              description={
                query || activeType !== 'ALL'
                  ? 'Try adjusting your search or type filter.'
                  : 'Create the first journal entry to populate this register.'
              }
              action={!query && activeType === 'ALL' && isSuperAdmin
                ? <Button variant="primary" size="sm" onClick={addModal.open}>+ Add Entry</Button>
                : undefined
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['Entry', 'Type', 'Author', 'Date', 'Status', 'Attachments', 'Actions'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map(entry => (
                      <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                        <td className="px-4 py-3.5 align-top">
                          <div className="space-y-1.5">
                            <div className="font-semibold text-sm text-slate-800">{entry.title}</div>
                            <div className="text-xs text-slate-500 leading-relaxed max-w-lg">{entry.summary}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 align-top">
                          <Badge className={typeBadgeClass(entry.type)}>{entry.type}</Badge>
                        </td>
                        <td className="px-4 py-3.5 align-top text-sm text-slate-600">{entry.author}</td>
                        <td className="px-4 py-3.5 align-top text-sm text-slate-600">
                          <span>📅 {formatDate(entry.created_at)}</span>
                        </td>
                        <td className="px-4 py-3.5 align-top">
                          <Badge className={statusBadgeClass(entry.status)}>{entry.status}</Badge>
                        </td>
                        <td className="px-4 py-3.5 align-top text-sm text-slate-600">{entry.attachments}</td>
                        <td className="px-4 py-3.5 align-top">
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => {
                              viewDisc.open(entry)
                              logViewDocument(entry.title).catch(() => {})
                            }}>
                              View
                            </Button>
                            {isSuperAdmin && (
                              <Button variant="outline" size="sm" onClick={() => editDisc.open(entry)}>Edit</Button>
                            )}
                            {isSuperAdmin && (
                              <Button variant="danger" size="sm" onClick={() => archiveDisc.open(entry)}>Archive</Button>
                            )}
                            {isSuperAdmin && (
                              <Button variant="danger" size="sm" onClick={() => deleteDisc.open(entry)}>Delete</Button>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(entry.title)}>
                              Copy title
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!loading && filteredEntries.length > 0 && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={filteredEntries.length}
                  pageSize={pageSize}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={setPageSize}
                  pageSizeOptions={[10, 20, 50]}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      {isSuperAdmin && (
        <AddJournalEntryModal
          open={addModal.isOpen}
          onClose={addModal.close}
          title="New Journal Entry"
          submitLabel="✅ Create Entry"
          onSubmit={handleCreate}
        />
      )}
      {isSuperAdmin && (
        <AddJournalEntryModal
          open={editDisc.isOpen}
          onClose={editDisc.close}
          title="Edit Journal Entry"
          submitLabel="💾 Save Changes"
          initialValue={editDisc.payload ?? undefined}
          onSubmit={handleEdit}
        />
      )}

      <ViewJournalModal
        entry={viewDisc.payload ?? null}
        open={viewDisc.isOpen}
        onClose={viewDisc.close}
        onViewAttachment={(fileUrl, fileName) => viewAttachmentDisc.open({ fileUrl, fileName })}
      />
      <ViewJournalAttachmentModal
        fileUrl={viewAttachmentDisc.payload?.fileUrl ?? ''}
        fileName={viewAttachmentDisc.payload?.fileName ?? 'Attachment'}
        open={viewAttachmentDisc.isOpen}
        onClose={viewAttachmentDisc.close}
      />

      {isSuperAdmin && (
        <ConfirmDialog
          open={archiveDisc.isOpen}
          title="Archive Journal Entry"
          message={`Move "${archiveDisc.payload?.title}" to the Archive?`}
          confirmLabel="Archive" variant="danger"
          onConfirm={handleArchive}
          onCancel={archiveDisc.close}
        />
      )}
      <ConfirmDialog
        open={deleteDisc.isOpen}
        title="Delete Journal Entry"
        message={`Delete "${deleteDisc.payload?.title}" permanently? This cannot be undone.`}
        confirmLabel="Delete" variant="danger"
        onConfirm={handleDelete}
        onCancel={deleteDisc.close}
      />
    </>
  )
}