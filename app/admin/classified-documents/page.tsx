'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, FileText, PencilLine, Plus, Printer, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { SearchInput } from '@/components/ui/SearchInput'
import { EmptyState } from '@/components/ui/EmptyState'
import { AlertWarning } from '@/components/ui/AlertWarning'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { AddConfidentialDocModal } from '@/components/modals/AddConfidentialDocModal'
import { useDisclosure, useModal } from '@/hooks'
import { useRealtimeClassifiedDocs } from '@/hooks/useRealtimeCollections'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import {
  addConfidentialDoc,
  getConfidentialDocs,
  updateConfidentialDoc,
  deleteConfidentialDoc,
} from '@/lib/data'
import { logEditDocument } from '@/lib/adminLogger'
import { classificationBadgeClass } from '@/lib/utils'
import {
  getDocumentVisibility,
  setClassifiedDocumentVisibility,
} from '@/lib/rbac'
import {
  canManageClassifiedDocuments,
  canPrintClassifiedDocuments,
  canDeleteClassifiedDocuments,
} from '@/lib/permissions'
import type { AdminRole } from '@/lib/auth'
import type { ConfidentialDoc } from '@/types'

type ClassifiedDocRecord = ConfidentialDoc & {
  fileUrl?: string
  passwordHash?: string
  archived?: boolean
  visibleRoles?: AdminRole[]
}

type DocUpdatePayload = {
  title: string
  classification: ConfidentialDoc['classification']
  date: string
  access: string
  fileUrl?: string | null
  passwordHash?: string | null
}

type EditModalProps = {
  open: boolean
  doc: ClassifiedDocRecord | null
  onClose: () => void
  onSubmit: (payload: DocUpdatePayload) => Promise<boolean>
}

function fileNameFromUrl(fileUrl: string, fallback: string): string {
  const rawName = fileUrl.split('/').pop()?.split('?')[0]
  return rawName ? decodeURIComponent(rawName) : fallback
}

function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password)
  return crypto.subtle.digest('SHA-256', data).then(hashBuffer => {
    return Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, '0')).join('')
  })
}

function filePreviewLabel(fileName: string): { icon: string; label: string } {
  if (/\.pdf$/i.test(fileName)) return { icon: '📕', label: 'PDF' }
  if (/\.docx?$/i.test(fileName)) return { icon: '📘', label: 'Word' }
  if (/\.xlsx?$/i.test(fileName)) return { icon: '📗', label: 'Excel' }
  if (/\.(jpg|jpeg|png|webp)$/i.test(fileName)) return { icon: '🖼️', label: 'Image' }
  return { icon: '📄', label: 'File' }
}

function visibilitySummary(roles?: AdminRole[]) {
  const recipients = (roles ?? ['P2']).filter(role => role !== 'P2')
  if (recipients.length === 0) return 'P2 only'
  return `P2 + ${recipients.join(', ')}`
}

function DocumentDetailModal({
  open,
  doc,
  onClose,
}: {
  open: boolean
  doc: ClassifiedDocRecord | null
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Classified Document Details" width="max-w-2xl">
      <div className="p-6 space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Title</p>
            <p className="text-sm font-bold text-slate-800 line-clamp-3 break-words">{doc?.title}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Classification</p>
            {doc && <Badge className={classificationBadgeClass(doc.classification)}>{doc.classification}</Badge>}
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Date</p>
            <p className="text-sm font-bold text-slate-800">{doc?.date}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Access</p>
            <p className="text-sm text-slate-700">{doc?.access}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Visibility</p>
            <p className="text-sm text-slate-700">{doc ? visibilitySummary(doc.visibleRoles) : 'P2 only'}</p>
          </div>
        </div>

        {doc?.fileUrl ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">File</p>
            <div className="flex items-center gap-2 flex-wrap">
              <a href={doc.fileUrl} className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                Open attached file
              </a>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            No attachment stored for this classified document.
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}

function EditDocumentModal({ open, doc, onClose, onSubmit }: EditModalProps) {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(doc?.title ?? '')
  const [classification, setClassification] = useState<ConfidentialDoc['classification']>(doc?.classification ?? 'RESTRICTED')
  const [date, setDate] = useState(doc?.date ?? new Date().toISOString().split('T')[0])
  const [access, setAccess] = useState(doc?.access ?? 'P2 only')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open || !doc) return
    setTitle(doc.title)
    setClassification(doc.classification)
    setDate(doc.date)
    setAccess(doc.access)
    setPassword('')
    setConfirmPassword('')
    setSelectedFile(null)
    setDragging(false)
    setErrors({})
    setShowPassword(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [doc, open])

  async function submit() {
    if (!doc) return

    const nextErrors: Record<string, string> = {}
    if (!title.trim()) nextErrors.title = 'Title is required.'
    if (!date) nextErrors.date = 'Date is required.'
    if (!access.trim()) nextErrors.access = 'Access description is required.'
    if (password && password !== confirmPassword) nextErrors.confirmPassword = 'Passwords do not match.'

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSaving(true)
    try {
      let fileUrl = doc.fileUrl ?? null
      let passwordHash = undefined as string | null | undefined

      if (selectedFile) {
        const fileName = `classified-${Date.now()}-${selectedFile.name.replace(/\s+/g, '_')}`
        const { data: storageData, error: storageError } = await supabase.storage
          .from('documents')
          .upload(fileName, selectedFile, { cacheControl: '3600', upsert: false })

        if (storageError) {
          toast.error('File upload failed. Please try again.')
          setSaving(false)
          return
        }

        const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storageData.path)
        fileUrl = urlData.publicUrl
      }

      if (password.trim()) {
        passwordHash = await hashPassword(password.trim())
      }

      const ok = await onSubmit({
        title: title.trim(),
        classification,
        date,
        access: access.trim(),
        fileUrl,
        passwordHash,
      })

      if (ok) {
        toast.success(`"${title.trim()}" updated.`)
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  const inputClass = (field: string) =>
    `w-full px-3 py-2.5 border-[1.5px] rounded-lg text-sm bg-slate-50 focus:outline-none focus:bg-white transition ${
      errors[field] ? 'border-red-400 focus:border-red-400' : 'border-slate-200 focus:border-blue-500'
    }`

  return (
    <Modal open={open} onClose={saving ? () => {} : onClose} title="Edit Classified Document" width="max-w-2xl">
      <div className="p-6 space-y-4">
        <AlertWarning message="Only P2 may update classified documents. Replacing the file or password is optional." />

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Document Title</label>
          <input className={inputClass('title')} value={title} onChange={e => setTitle(e.target.value)} disabled={saving} />
          {errors.title && <p className="mt-1 text-xs font-medium text-red-500">{errors.title}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Classification</label>
            <select className={inputClass('classification')} value={classification} onChange={e => setClassification(e.target.value as ConfidentialDoc['classification'])} disabled={saving}>
              <option value="RESTRICTED">Restricted</option>
              <option value="CONFIDENTIAL">Confidential</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Date</label>
            <input type="date" className={inputClass('date')} value={date} onChange={e => setDate(e.target.value)} disabled={saving} />
            {errors.date && <p className="mt-1 text-xs font-medium text-red-500">{errors.date}</p>}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Access Note</label>
          <input className={inputClass('access')} value={access} onChange={e => setAccess(e.target.value)} disabled={saving} />
          {errors.access && <p className="mt-1 text-xs font-medium text-red-500">{errors.access}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">New Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                className={`${inputClass('password')} pr-10`}
                placeholder="Leave blank to keep the current password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={saving}
              />
              <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                {showPassword ? '🙈' : '👁'}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Confirm Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              className={inputClass('confirmPassword')}
              placeholder="Repeat the new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              disabled={saving}
            />
            {errors.confirmPassword && <p className="mt-1 text-xs font-medium text-red-500">{errors.confirmPassword}</p>}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
          className="hidden"
          onChange={e => setSelectedFile(e.target.files?.[0] ?? null)}
        />

        {selectedFile ? (
          <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="min-w-0 flex items-center gap-3">
              <span className="text-2xl">{filePreviewLabel(selectedFile.name).icon}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{selectedFile.name}</p>
                <p className="text-xs text-slate-400">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>
            <button
              type="button"
              className="ml-3 text-sm font-bold text-slate-400 hover:text-red-500"
              onClick={() => {
                setSelectedFile(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
            >
              ✕
            </button>
          </div>
        ) : (
          <div
            onDragOver={e => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setDragging(false)
              setSelectedFile(e.dataTransfer.files?.[0] ?? null)
            }}
            onClick={() => !saving && fileInputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${
              dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50'
            } ${saving ? 'pointer-events-none opacity-60' : ''}`}
          >
            <div className="mb-1 text-3xl">📁</div>
            <p className="mb-1 text-sm font-medium text-slate-600">Replace attachment</p>
            <p className="text-xs text-slate-400">Optional. PDF, Word, Excel, JPG, PNG, or WebP.</p>
          </div>
        )}

        {saving && (
          <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm font-medium text-blue-700">Saving changes…</p>
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-1">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>Save Changes</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function ClassifiedDocumentsPage() {
  const { toast } = useToast()
  const { user } = useAuth()

  const [docs, setDocs] = useState<ClassifiedDocRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'private'>('all')

  useRealtimeClassifiedDocs({ setDocs })

  const addModal = useModal()
  const detailDisc = useDisclosure<ClassifiedDocRecord>()
  const editDisc = useDisclosure<ClassifiedDocRecord>()
  const deleteDisc = useDisclosure<ClassifiedDocRecord>()

  const canManage = user?.role ? canManageClassifiedDocuments(user.role as AdminRole) : false
  const canPrint = user?.role ? canPrintClassifiedDocuments(user.role as AdminRole) : false
  const canDelete = user?.role ? canDeleteClassifiedDocuments(user.role as AdminRole) : false

  const loadDocs = useCallback(async () => {
    if (!user) {
      setDocs([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const remoteDocs = await getConfidentialDocs()
      const activeDocs = (remoteDocs ?? []).filter(doc => !doc.archived)

      const loadedDocs = await Promise.all(
        activeDocs.map(async doc => {
          const visibleRoles = await getDocumentVisibility(doc.id, 'classified_document')
          return { ...doc, visibleRoles: visibleRoles || ['P2'] }
        })
      )

      setDocs(loadedDocs)
    } catch (error) {
      console.error(error)
      toast.error('Failed to load classified documents.')
      setDocs([])
    } finally {
      setLoading(false)
    }
  }, [toast, user])

  useEffect(() => {
    void loadDocs()
  }, [loadDocs])

  const stats = useMemo(() => {
    const p2Only = docs.filter(doc => doc.visibleRoles && Array.isArray(doc.visibleRoles) && doc.visibleRoles.every(role => role === 'P2')).length

    return { p2Only }
  }, [docs])


  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase()
    return docs.filter(doc => {
      const matchesQuery = !q || [doc.title, doc.access, doc.classification, doc.date].some(field => field.toLowerCase().includes(q))
      const forwarded = doc.visibleRoles && Array.isArray(doc.visibleRoles) ? doc.visibleRoles.some(role => role !== 'P2') : false
      const matchesFilter = filter === 'all' || (filter === 'private' && !forwarded)
      return matchesQuery && matchesFilter
    })
  }, [docs, filter, query])

  async function handleAdd(newDoc: ConfidentialDoc & { fileUrl?: string; passwordHash?: string }) {
    if (!canManage) {
      toast.error('Only P2 can add classified documents.')
      return
    }

    const ok = await addConfidentialDoc(newDoc)
    if (!ok) {
      toast.error('Could not save the classified document.')
      return
    }

    const visibilityOk = await setClassifiedDocumentVisibility(newDoc.id, newDoc.title)
    if (!visibilityOk) {
      toast.error('Saved, but P2 visibility could not be established.')
    }
  }

  async function handleEdit(payload: DocUpdatePayload): Promise<boolean> {
    if (!canManage) {
      toast.error('Only P2 can edit classified documents.')
      return false
    }

    const doc = editDisc.payload
    if (!doc) return false

    const ok = await updateConfidentialDoc(doc.id, payload)
    if (!ok) {
      toast.error('Could not update the classified document.')
      return false
    }

    await logEditDocument(doc.title)
    return true
  }

  async function handleDelete() {
    if (!canDelete) {
      toast.error('Only P2 can delete classified documents.')
      return
    }

    const doc = deleteDisc.payload
    if (!doc) return

    await deleteConfidentialDoc(doc.id)
    deleteDisc.close()
    toast.success(`"${doc.title}" deleted.`)
  }

  async function handlePrint(doc: ClassifiedDocRecord) {
    if (!canPrint) {
      toast.error('Only P2 can print classified documents.')
      return
    }

    if (!doc.fileUrl) {
      toast.warning('This document has no file attached.')
      return
    }

    const printWindow = window.open(doc.fileUrl, '_blank', 'width=800,height=600')
    if (printWindow) {
      printWindow.addEventListener('load', () => {
        printWindow.print()
      })
    }
    toast.success(`Printing "${doc.title}".`)
  }

  return (
    <>
      <PageHeader title="Classified Documents" />

      <div className="p-8 space-y-6">
        {!canManage && (
          <div className="max-w-4xl">
            <AlertWarning message="Only P2 can manage classified documents (upload, edit, delete, archive, print). Other roles are view-only." />
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Active Records</p>
            <div className="mt-3 flex items-end justify-between">
              <p className="text-3xl font-black text-slate-800">{docs.length}</p>
              <FileText className="h-6 w-6 text-slate-300" />
            </div>
            <p className="mt-2 text-sm text-slate-500">Viewable by P2. Managed by P2.</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">P2 Only</p>
            <div className="mt-3 flex items-end justify-between">
              <p className="text-3xl font-black text-slate-800">{stats.p2Only}</p>
              <Eye className="h-6 w-6 text-slate-300" />
            </div>
            <p className="mt-2 text-sm text-slate-500">Documents visible only to P2.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-800">Classified Records</h2>
              <p className="mt-1 text-sm text-slate-500">View classified records. P2 can create, edit, and delete.</p>
            </div>
            {canManage && (
              <Button variant="primary" onClick={addModal.open}>
                <Plus size={16} /> Add Document
              </Button>
            )}
          </div>

          <div className="border-b border-slate-100 bg-slate-50 px-6 py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <SearchInput value={query} onChange={setQuery} placeholder="Search classified documents…" className="w-full lg:max-w-sm" />
            <div className="flex items-center gap-2">
              {(['all', 'private'] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFilter(option)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-widest transition ${
                    filter === option ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-blue-300 hover:text-blue-600'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : filteredDocs.length === 0 ? (
            <EmptyState
              icon="🔐"
              title="No classified documents"
              description={query ? 'No documents matched your search.' : 'Add the first classified document for P2 to manage.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {['Document', 'Classification', 'Date', 'Visibility', 'Actions'].map(header => (
                      <th key={header} className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-400">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map(doc => {
                    return (
                      <tr key={doc.id} className="border-b border-slate-100 hover:bg-slate-50/80 transition">
                        <td className="px-5 py-4 align-top">
                          <button type="button" onClick={() => detailDisc.open(doc)} className="flex items-center gap-3 text-left">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                              <FileText size={18} />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-800 hover:text-blue-600 truncate">{doc.title}</p>
                              <p className="text-xs text-slate-400 truncate">{doc.access}</p>
                            </div>
                          </button>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <Badge className={classificationBadgeClass(doc.classification)}>{doc.classification}</Badge>
                        </td>
                        <td className="px-5 py-4 align-top text-sm text-slate-600">
                          <div className="flex flex-col gap-0.5">
                            
                            {doc.created_at && (
                              <span className="text-xs">📅 {new Date(doc.created_at).toLocaleString('en-PH', { 
                                year: 'numeric', 
                                month: 'short', 
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <Badge className="bg-slate-100 text-slate-600">P2 Only</Badge>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="flex flex-wrap gap-2">
                            <Button variant="ghost" size="sm" onClick={() => detailDisc.open(doc)}>
                              <Eye size={14} /> View
                            </Button>
                            {canManage && (
                              <Button variant="ghost" size="sm" onClick={() => editDisc.open(doc)}>
                                <PencilLine size={14} /> Edit
                              </Button>
                            )}
                            {canPrint && (
                              <Button variant="ghost" size="sm" onClick={() => handlePrint(doc)}>
                                <Printer size={14} /> Print
                              </Button>
                            )}
                            {canDelete && (
                              <Button variant="ghost" size="sm" onClick={() => deleteDisc.open(doc)} className="text-red-600 hover:bg-red-50">
                                <Trash2 size={14} /> Delete
                              </Button>
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

      <AddConfidentialDocModal
        open={addModal.isOpen}
        onClose={addModal.close}
        onAdd={handleAdd}
      />

      <DocumentDetailModal
        open={detailDisc.isOpen}
        doc={detailDisc.payload ?? null}
        onClose={detailDisc.close}
      />

      <EditDocumentModal
        open={editDisc.isOpen}
        doc={editDisc.payload ?? null}
        onClose={editDisc.close}
        onSubmit={handleEdit}
      />

      <ConfirmDialog
        open={deleteDisc.isOpen}
        title="Delete Classified Document"
        message={`Delete "${deleteDisc.payload?.title ?? 'this document'}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={deleteDisc.close}
      />

    </>
  )
}