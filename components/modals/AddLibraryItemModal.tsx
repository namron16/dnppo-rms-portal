'use client'
// components/modals/AddLibraryItemModal.tsx
//
// FIX: Upload is now open to all P1–P10, WCPD, and PPSMU accounts.
//      Each item is tagged with uploaded_by = user.role so the page
//      only shows each user their own items (privileged roles see all).
//      The Drive gateway routes the file to the uploader's own connected
//      Google Drive account — never another user's Drive.
//
// FIX (Drive pool columns): newItem now includes gdrive_file_id,
//      gdrive_url, pool_account_id, file_name, file_size_bytes, mime_type
//      from the upload result. Previously these were available in uploadResult
//      but never written into the newItem object passed to addLibraryItem(),
//      so the DB row always had null Drive pool columns, making forwarding fail.

import { useRef, useState } from 'react'
import { Modal }    from '@/components/ui/Modal'
import { Button }   from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { AddLibraryItemSchema, zodErrors } from '@/lib/validations'
import { assertCanUpload } from '@/lib/rbac'
import { useDriveUpload } from '@/hooks/useGDriveTool'
import { useAuth } from '@/lib/auth'
import type { AdminRole } from '@/lib/auth'
import { addLibraryItem } from '@/lib/data'
import { logAddLibraryItem } from '@/lib/adminLogger'
import type { LibraryCategory } from '@/types'

type LibraryItemWithUrl = {
  id:              string
  title:           string
  category:        LibraryCategory
  size:            string
  dateAdded:       string
  fileUrl?:        string
  description?:    string
  created_at?:     string
  uploaded_by?:    string
  // FIX: Drive pool fields
  gdrive_file_id?:  string
  gdrive_url?:      string
  pool_account_id?: string
  file_name?:       string
  file_size_bytes?: number
  mime_type?:       string
}

interface Props {
  open: boolean
  onClose: () => void
  onAdd?: (item: LibraryItemWithUrl) => void
}

export function AddLibraryItemModal({ open, onClose, onAdd }: Props) {
  const { toast } = useToast()
  const { user }  = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { uploadToDrive, uploading, error: uploadError } = useDriveUpload()

  const [errors,   setErrors]   = useState<Record<string, string>>({})
  const [file,     setFile]     = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [form, setForm] = useState({
    title:       '',
    category:    'MANUAL' as LibraryCategory,
    description: '',
  })

  const field = (key: string, value: string) => {
    setForm(p => ({ ...p, [key]: value }))
    setErrors(p => ({ ...p, [key]: '' }))
  }

  function handleFileChange(nextFile: File | null) {
    if (!nextFile) return
    setFile(nextFile)
    setErrors(prev => ({ ...prev, file: '' }))
  }

  function resetAndClose() {
    setForm({ title: '', category: 'MANUAL', description: '' })
    setErrors({})
    setFile(null)
    setDragging(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    onClose()
  }

  async function submit() {
    if (!user) { toast.error('Not authenticated.'); return }

    try {
      assertCanUpload(user.role as AdminRole)
    } catch (err: any) {
      toast.error(err.message ?? 'Upload denied.')
      return
    }

    const nextErrors: Record<string, string> = {}
    if (!form.title.trim())       nextErrors.title       = 'Title is required.'
    if (!form.category.trim())    nextErrors.category    = 'Category is required.'
    if (!form.description.trim()) nextErrors.description = 'Description is required.'
    if (!file)                    nextErrors.file        = 'Attachment is required.'

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    const result = AddLibraryItemSchema.safeParse(form)
    if (!result.success) {
      setErrors(zodErrors(result.error))
      return
    }

    setErrors({})

    try {
      const itemId = `lib-${Date.now()}`
      const today  = new Date().toISOString().split('T')[0]
      const now    = new Date().toISOString()

      const uploadResult = await uploadToDrive(file!, 'library_items', {
        uploadedBy: user.role,
        entityId:   itemId,
        entityType: 'library_item',
      })

      if (!uploadResult) {
        toast.error(uploadError ?? 'File upload failed. Please try again.')
        return
      }

      const fileSize = file!.size < 1024 * 1024
        ? `${(file!.size / 1024).toFixed(1)} KB`
        : `${(file!.size / 1024 / 1024).toFixed(1)} MB`

      // FIX: include all Drive pool fields in newItem so addLibraryItem()
      // persists them to the DB. Previously only fileUrl was set here;
      // gdrive_file_id, pool_account_id etc. were silently dropped.
      const newItem: LibraryItemWithUrl = {
        id:          itemId,
        title:       result.data.title.trim(),
        category:    result.data.category as LibraryCategory,
        size:        fileSize,
        dateAdded:   today,
        fileUrl:     uploadResult.fileUrl,
        description: form.description.trim() || undefined,
        created_at:  now,
        uploaded_by: user.role,
        // FIX: Drive pool fields
        gdrive_file_id:  uploadResult.gdriveFileId,
        gdrive_url:      uploadResult.fileUrl,
        pool_account_id: uploadResult.poolAccountId,
        file_name:       file!.name,
        file_size_bytes: file!.size,
        mime_type:       file!.type || undefined,
      }

      await addLibraryItem(newItem)
      await logAddLibraryItem(result.data.title)

      toast.success(`"${result.data.title}" added to the Library.`)
      onAdd?.(newItem)
      resetAndClose()
    } catch (err) {
      console.error(err)
      toast.error('Something went wrong. Please try again.')
    }
  }

  const hasMissingRequired =
    !form.title.trim()       ||
    !form.category.trim()    ||
    !form.description.trim() ||
    !file

  const cls = (f: string) =>
    `w-full px-3 py-2.5 border-[1.5px] rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition ${
      errors[f] ? 'border-red-400 focus:border-red-400' : 'border-slate-200'
    }`

  return (
    <Modal open={open} onClose={uploading ? () => {} : resetAndClose} title="Add to Library" width="max-w-md">
      <div className="p-6 space-y-4">

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            className={cls('title')}
            placeholder="e.g. PNP Anti-Corruption Manual 2024"
            value={form.title}
            onChange={e => field('title', e.target.value)}
            disabled={uploading}
          />
          {errors.title && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.title}</p>}
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Category <span className="text-red-500">*</span>
          </label>
          <select
            className={cls('category')}
            value={form.category}
            onChange={e => field('category', e.target.value)}
            disabled={uploading}
          >
            <option value="MANUAL">Manual</option>
            <option value="GUIDELINE">Guideline</option>
            <option value="TEMPLATE">Template</option>
          </select>
          {errors.category && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.category}</p>}
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Description <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={3}
            className={`${cls('description')} resize-none`}
            placeholder="Brief description of this library item…"
            value={form.description}
            onChange={e => field('description', e.target.value)}
            disabled={uploading}
          />
          {errors.description && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.description}</p>}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={e => handleFileChange(e.target.files?.[0] ?? null)}
        />

        {file ? (
          <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border-[1.5px] border-blue-200 rounded-xl">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl flex-shrink-0">📗</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                <p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>
            {!uploading && (
              <button
                onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                className="text-slate-400 hover:text-red-500 font-bold text-sm ml-3 flex-shrink-0"
              >
                ✕
              </button>
            )}
          </div>
        ) : (
          <div
            onDragOver={e  => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setDragging(false)
              handleFileChange(e.dataTransfer.files?.[0] ?? null)
            }}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
              errors.file
                ? 'border-red-400 bg-red-50'
                : dragging
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50'
            } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
          >
            <div className="text-2xl mb-1.5">📗</div>
            <p className="text-sm font-medium text-slate-600 mb-0.5">Click to browse or drag &amp; drop</p>
            <p className="text-xs text-slate-400">PDF, JPG, PNG — max 50 MB</p>
          </div>
        )}

        {errors.file && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.file}</p>}

        {uploading && (
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-blue-700 font-medium">Uploading to Google Drive…</p>
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-1">
          <Button variant="outline" onClick={resetAndClose} disabled={uploading}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={hasMissingRequired || uploading}>
            {uploading ? 'Uploading…' : '📚 Add to Library'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}