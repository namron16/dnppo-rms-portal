'use client'
// components/modals/AddSpecialOrderModal.tsx
//
// FIX: Upload is now open to all P1–P10, WCPD, and PPSMU accounts.
//      Each SO is tagged with uploaded_by = user.role so the page
//      only shows each user their own orders (privileged roles see all).
//      The Drive gateway routes the file to the uploader's own connected
//      Google Drive account — never another user's Drive.

import { useRef, useState } from 'react'
import { Modal }    from '@/components/ui/Modal'
import { Button }   from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { AddSpecialOrderSchema, zodErrors } from '@/lib/validations'
import { assertCanUpload } from '@/lib/rbac'
import { useDriveUpload } from '@/hooks/useGDriveTool'
import { useAuth } from '@/lib/auth'
import type { SpecialOrder } from '@/types'
import type { AdminRole } from '@/lib/auth'
import { FileText, Image as ImageIcon, Paperclip } from 'lucide-react'
import { logUploadDocument } from '@/lib/adminLogger'

type SOWithUrl = SpecialOrder & {
  fileUrl?:         string
  gdrive_file_id?:  string
  gdrive_url?:      string
  pool_account_id?: string
  download_url?:    string
  uploaded_by?:     string   // tracks who uploaded this order
  file_name?:      string   // for Drive uploads, store original file name
  file_size_bytes?: number   // for Drive uploads, store original file size
  mime_type?:      string | null // for Drive uploads, store original MIME type
}

interface Props {
  open: boolean
  onClose: () => void
  onAdd?: (newSO: SOWithUrl) => Promise<void>
}

export function AddSpecialOrderModal({ open, onClose, onAdd }: Props) {
  const { toast } = useToast()
  const { user }  = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const today = new Date().toISOString().split('T')[0]

  const { uploadToDrive, uploading, error: uploadError } = useDriveUpload()

  const [form, setForm]         = useState({ reference: '', subject: '', date: today, status: 'ACTIVE' })
  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [file, setFile]         = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)

  function field(key: string, value: string) {
    setForm(p => ({ ...p, [key]: value }))
    setErrors(p => ({ ...p, [key]: '' }))
  }

  function handleFileChange(incoming: File | null) {
    if (!incoming) return
    setFile(incoming)
    setErrors(prev => ({ ...prev, file: '' }))
  }

  function resetAndClose() {
    setForm({ reference: '', subject: '', date: today, status: 'ACTIVE' })
    setErrors({})
    setFile(null)
    setDragging(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    onClose()
  }

  async function submit() {
    if (!user) { toast.error('Not authenticated.'); return }

    // FIX: assertCanUpload now allows P1–P10, WCPD, PPSMU (not just P1)
    try {
      assertCanUpload(user.role as AdminRole)
    } catch (err: any) {
      toast.error(err.message ?? 'Upload denied.')
      return
    }

    const result = AddSpecialOrderSchema.safeParse(form)
    if (!result.success) {
      setErrors(zodErrors(result.error))
      return
    }

    if (!file) {
      setErrors(prev => ({ ...prev, file: 'Attachment is required.' }))
      return
    }

    setErrors({})

    try {
      const soId = `so-${Date.now()}`

      // Upload to THIS user's own connected Google Drive account.
      const driveResult = await uploadToDrive(file, 'special_orders', {
        uploadedBy: user.role,
        entityId:   soId,
        entityType: 'special_order',
      })

      if (!driveResult) {
        toast.error(uploadError ?? 'File upload failed. Please try again.')
        return
      }

      // Tag the order with the uploader's role so the page can filter per user.
      const newSO: SOWithUrl = {
         id:          soId,
          reference:   result.data.reference,
          subject:     result.data.subject,
          date:        result.data.date,
          attachments: 0,
          status:      result.data.status,
        
          fileUrl:          driveResult.fileUrl,
          gdrive_file_id:   driveResult.gdriveFileId,
          gdrive_url:       driveResult.fileUrl,
          pool_account_id:  driveResult.poolAccountId,
          download_url:     driveResult.downloadUrl,
        
          uploaded_by:     user.role,
          // FIX: these three were missing
          file_name:       file.name,
          file_size_bytes: file.size,
          mime_type:       file.type || null,
      }

      if (onAdd) await onAdd(newSO)
      await logUploadDocument(result.data.subject)
      toast.success(`Special Order "${result.data.reference}" created.`)
      resetAndClose()
    } catch (err) {
      console.error('[AddSpecialOrderModal] submit error:', err)
      const message = err instanceof Error ? err.message : 'Something went wrong. Please try again.'
      toast.error(message)
    }
  }

  const cls = (f: string) =>
    `w-full px-3 py-2.5 border-[1.5px] rounded-lg text-sm bg-slate-50 focus:outline-none focus:bg-white transition ${
      errors[f] ? 'border-red-400 focus:border-red-400' : 'border-slate-200 focus:border-blue-500'
    }`

  const fileIcon =
    file?.name.endsWith('.pdf') ? <FileText size={28} className="text-red-600" />
    : file?.name.match(/\.(jpg|jpeg|png|webp)$/i) ? <ImageIcon size={28} className="text-violet-600" />
    : <FileText size={28} className="text-slate-600" />

  return (
    <Modal open={open} onClose={uploading ? () => {} : resetAndClose} title="New Special Order" width="max-w-lg">
      <div className="p-6 space-y-4">

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              SO Reference <span className="text-red-500">*</span>
            </label>
            <input className={cls('reference')} placeholder="e.g. SO No. 2024-102"
              value={form.reference} onChange={e => field('reference', e.target.value)} disabled={uploading} />
            {errors.reference && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.reference}</p>}
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Date <span className="text-red-500">*</span>
            </label>
            <input type="date" className={cls('date')}
              value={form.date} onChange={e => field('date', e.target.value)} disabled={uploading} />
            {errors.date && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.date}</p>}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Subject <span className="text-red-500">*</span>
          </label>
          <input className={cls('subject')} placeholder="e.g. Designation of Officers – Q2"
            value={form.subject} onChange={e => field('subject', e.target.value)} disabled={uploading} />
          {errors.subject && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.subject}</p>}
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={e => handleFileChange(e.target.files?.[0] ?? null)}
        />

        {/* File picker / preview */}
        {file ? (
          <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border-[1.5px] border-blue-200 rounded-xl">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex-shrink-0">{fileIcon}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                <p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>
            {!uploading && (
              <button
                onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                className="text-slate-400 hover:text-red-500 font-bold text-sm ml-3 flex-shrink-0 transition"
              >✕</button>
            )}
          </div>
        ) : (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFileChange(e.dataTransfer.files?.[0] ?? null) }}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition select-none ${
              errors.file
                ? 'border-red-400 bg-red-50'
                : dragging
                  ? 'border-blue-400 bg-blue-50'
                  : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50'
            } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
          >
            <div className="mb-2 flex justify-center text-blue-600">
              <Paperclip size={30} strokeWidth={2.1} />
            </div>
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
          <Button variant="primary" onClick={submit} disabled={uploading || !file}>
            {uploading ? 'Uploading…' : '✅ Create SO'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}