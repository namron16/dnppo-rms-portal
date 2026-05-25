'use client'
// components/modals/AddDocumentModal.tsx
//
// FIX: Upload is now open to all P1–P10, WCPD, and PPSMU accounts.
//      Each document is tagged with uploaded_by = user.role so the page
//      only shows each user their own documents (privileged roles see all).
//      The Drive gateway routes the file to the uploader's own connected
//      Google Drive account — never another user's Drive.

import { useState, useRef } from 'react'
import { Modal }    from '@/components/ui/Modal'
import { Button }   from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { AddDocumentSchema, zodErrors } from '@/lib/validations'
import { assertCanUpload } from '@/lib/rbac'
import { useAuth } from '@/lib/auth'
import { useDriveUpload } from '@/hooks/useGDriveTool'
import { logUploadDocument } from '@/lib/adminLogger'
import type { MasterDocument } from '@/types'
import type { AdminRole } from '@/lib/auth'

type DocWithUrl = MasterDocument & {
  fileUrl?:         string
  gdrive_file_id?:  string
  gdrive_url?:      string
  pool_account_id?: string
  download_url?:    string
  uploaded_by?:     string   // tracks who uploaded this document
}

interface AddDocumentModalProps {
  open: boolean
  onClose: () => void
  onAdd?: (newDoc: DocWithUrl) => Promise<void>
}

export function AddDocumentModal({ open, onClose, onAdd }: AddDocumentModalProps) {
  const { toast }  = useToast()
  const { user }   = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const today = new Date().toISOString().split('T')[0]

  const { uploadToDrive, uploading, error: uploadError } = useDriveUpload()

  const [file, setFile]           = useState<File | null>(null)
  const [dragging, setDragging]   = useState(false)
  const [errors, setErrors]       = useState<Record<string, string>>({})

  const [form, setForm] = useState({
    title: '', level: 'REGIONAL', type: 'PDF', date: today, tag: 'COMPLIANCE',
  })

  function handleChange(key: string, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    setErrors(prev => ({ ...prev, [key]: '' }))
  }

  function handleFileChange(incoming: File | null) {
    if (!incoming) return
    setFile(incoming)
    setErrors(prev => ({ ...prev, file: '' }))
    const ext = incoming.name.split('.').pop()?.toUpperCase() ?? ''
    if (['PDF', 'DOCX', 'DOC', 'XLSX', 'XLS'].includes(ext)) {
      const mapped = ext.startsWith('DOC') ? 'DOCX' : ext.startsWith('XLS') ? 'XLSX' : ext
      setForm(prev => ({ ...prev, type: mapped }))
    } else if (['JPG', 'JPEG', 'PNG', 'WEBP'].includes(ext)) {
      setForm(prev => ({ ...prev, type: 'Image' }))
    }
  }

  function resetAndClose() {
    setForm({ title: '', level: 'REGIONAL', type: 'PDF', date: today, tag: 'COMPLIANCE' })
    setErrors({})
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    onClose()
  }

  async function handleSubmit() {
    if (!user) { toast.error('Not authenticated.'); return }

    // FIX: assertCanUpload now allows P1–P10, WCPD, PPSMU (not just P1)
    try {
      assertCanUpload(user.role as AdminRole)
    } catch (err: any) {
      toast.error(err.message ?? 'Upload denied.')
      return
    }

    const result = AddDocumentSchema.safeParse(form)
    if (!result.success) { setErrors(zodErrors(result.error)); return }

    if (!file) {
      setErrors(prev => ({ ...prev, file: 'Attachment is required.' }))
      toast.error('Please attach a file before uploading.')
      return
    }

    setErrors({})

    try {
      const newDocId = `md-${Date.now()}`

      // Upload to THIS user's own connected Google Drive account.
      // The gateway uses uploadedBy to scope the Drive account selection —
      // it will never route to another user's Drive.
      const driveResult = await uploadToDrive(file, 'master_documents', {
        uploadedBy: user.role,
        entityId:   newDocId,
        entityType: 'master_document',
      })

      if (!driveResult) {
        toast.error(uploadError ?? 'File upload failed. Please try again.')
        return
      }

      const fileSize = (file.size / 1024 / 1024).toFixed(1) + ' MB'

      // Tag the document with the uploader's role so the page can filter
      // and show each user only their own documents.
      const newDoc: DocWithUrl = {
        id:      newDocId,
        title:   result.data.title,
        level:   result.data.level as MasterDocument['level'],
        type:    result.data.type,
        date:    result.data.date,
        size:    fileSize,
        tag:     result.data.tag,

        fileUrl:          driveResult.fileUrl,
        gdrive_file_id:   driveResult.gdriveFileId,
        gdrive_url:       driveResult.fileUrl,
        pool_account_id:  driveResult.poolAccountId,
        download_url:     driveResult.downloadUrl,

        uploaded_by: user.role,
      }

      if (onAdd) await onAdd(newDoc)
      await logUploadDocument(result.data.title)

      toast.success(`"${result.data.title}" uploaded successfully.`)
      resetAndClose()
    } catch (err) {
      console.error('[AddDocumentModal] handleSubmit error:', err)
      toast.error('Something went wrong. Please try again.')
    }
  }

  const cls = (f: string) =>
    `w-full px-3 py-2.5 border-[1.5px] rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition disabled:opacity-50 ${
      errors[f] ? 'border-red-400 focus:border-red-400' : 'border-slate-200'
    }`

  const fileIcon =
    file?.name.endsWith('.pdf')       ? '📕'
    : file?.name.match(/\.docx?$/i)  ? '📘'
    : file?.name.match(/\.xlsx?$/i)  ? '📗'
    : file?.name.match(/\.(jpg|jpeg|png|webp)$/i) ? '🖼️'
    : '📄'

  return (
    <Modal open={open} onClose={uploading ? () => {} : resetAndClose} title="Upload Master Document" width="max-w-lg">
      <div className="p-6 space-y-4">

        {/* Title */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Document Title <span className="text-red-500">*</span>
          </label>
          <input className={cls('title')} value={form.title}
            onChange={e => handleChange('title', e.target.value)}
            placeholder="e.g. RO XI General Circular No. 2024-08"
            disabled={uploading} />
          {errors.title && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.title}</p>}
        </div>

        {/* Level + Tag */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Level</label>
            <select className={cls('level')} value={form.level} onChange={e => handleChange('level', e.target.value)} disabled={uploading}>
              <option value="REGIONAL">Regional</option>
              <option value="PROVINCIAL">Provincial</option>
              <option value="STATION">Station</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Tag</label>
            <select className={cls('tag')} value={form.tag} onChange={e => handleChange('tag', e.target.value)} disabled={uploading}>
              <option value="COMPLIANCE">Compliance</option>
              <option value="DIRECTIVE">Directive</option>
              <option value="CIRCULAR">Circular</option>
              <option value="MEMORANDUM">Memorandum</option>
            </select>
          </div>
        </div>

        {/* Date + Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Document Date <span className="text-red-500">*</span>
            </label>
            <input type="date" className={cls('date')} value={form.date} onChange={e => handleChange('date', e.target.value)} disabled={uploading} />
            {errors.date && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.date}</p>}
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">File Type</label>
            <select className={cls('type')} value={form.type} onChange={e => handleChange('type', e.target.value)} disabled={uploading}>
              <option value="PDF">PDF</option>
              <option value="Image">Image</option>
            </select>
          </div>
        </div>

        {/* File upload */}
        <input ref={fileInputRef} type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={e => handleFileChange(e.target.files?.[0] ?? null)} />

        {file ? (
          <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border-[1.5px] border-blue-200 rounded-xl">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl flex-shrink-0">{fileIcon}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                <p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>
            {!uploading && (
              <button onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                className="text-slate-400 hover:text-red-500 font-bold text-sm ml-3 flex-shrink-0 transition">✕</button>
            )}
          </div>
        ) : (
          <div onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFileChange(e.dataTransfer.files?.[0] ?? null) }}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition select-none ${
              errors.file
                ? 'border-red-400 bg-red-50'
                : dragging
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50'
            } ${uploading ? 'pointer-events-none opacity-50' : ''}`}>
            <div className="text-3xl mb-2">📁</div>
            <p className="text-sm font-medium text-slate-600 mb-1">Click to browse or drag &amp; drop</p>
            <p className="text-xs text-slate-400">PDF, JPG — max 50 MB</p>
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
          <Button variant="primary" onClick={handleSubmit} disabled={uploading || !file}>
            {uploading ? 'Uploading…' : '📤 Upload'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}