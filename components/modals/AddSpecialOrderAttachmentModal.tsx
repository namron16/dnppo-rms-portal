'use client'
// components/modals/AddSpecialOrderAttachmentModal.tsx
//
// Shown when a user clicks "+ Attach file" on a Special Order (Admin Order).
// Collects Reference, Subject, and Date before uploading the file so every
// attachment carries the same metadata as a top-level Special Order.

import { useState, useRef } from 'react'
import { Modal }    from '@/components/ui/Modal'
import { Button }   from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useAuth }  from '@/lib/auth'
import { useDriveUpload } from '@/hooks/useGDriveTool'
import { z } from 'zod'
import { zodErrors } from '@/lib/validations'
import { Paperclip } from 'lucide-react'

// ── Schema ────────────────────────────────────────────────────────────────────

const SOAttachmentSchema = z.object({
  reference: z
    .string()
    .min(1, 'Reference is required.')
    .max(100, 'Reference must be 100 characters or less.'),
  subject: z
    .string()
    .min(1, 'Subject is required.')
    .max(300, 'Subject must be 300 characters or less.'),
  date: z.string().min(1, 'Date is required.'),
})

type SOAttachmentInput = z.infer<typeof SOAttachmentSchema>

// ── Result returned to parent ─────────────────────────────────────────────────

export interface SOAttachmentUploadResult {
  reference:      string
  subject:        string
  date:           string
  file:           File
  fileName:       string
  fileSizeBytes:  number
  mimeType:       string
  gdriveFileId:   string
  gdriveUrl:      string
  poolAccountId:  string
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open:         boolean
  onClose:      () => void
  /** Called after a successful upload. */
  onAttached:   (result: SOAttachmentUploadResult) => void
  /** ID of the root Special Order — used as entityId for Drive upload. */
  parentOrderId:  string
  /** ID of the parent attachment row if attaching nested under an attachment. */
  parentAttId?:   string | null
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AddSpecialOrderAttachmentModal({
  open,
  onClose,
  onAttached,
  parentOrderId,
  parentAttId,
}: Props) {
  const { toast }  = useToast()
  const { user }   = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const today = new Date().toISOString().split('T')[0]

  const { uploadToDrive, uploading } = useDriveUpload()

  const [file,     setFile]     = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [errors,   setErrors]   = useState<Record<string, string>>({})

  const [form, setForm] = useState<SOAttachmentInput>({
    reference: '',
    subject:   '',
    date:      today,
  })

  // Reset form when modal opens
  const prevOpen = useRef(false)
  if (open && !prevOpen.current) {
    setTimeout(() => {
      setForm({ reference: '', subject: '', date: today })
      setErrors({})
      setFile(null)
    }, 0)
  }
  prevOpen.current = open

  function handleChange(key: keyof SOAttachmentInput, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    setErrors(prev => ({ ...prev, [key]: '' }))
  }

  function handleFileChange(incoming: File | null) {
    if (!incoming) return
    setFile(incoming)
    setErrors(prev => ({ ...prev, file: '' }))
  }

  function resetAndClose() {
    setForm({ reference: '', subject: '', date: today })
    setErrors({})
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    onClose()
  }

  async function handleSubmit() {
    if (!user) { toast.error('Not authenticated.'); return }
    if (!file) {
      setErrors(prev => ({ ...prev, file: 'Please select a file to attach.' }))
      return
    }

    const parsed = SOAttachmentSchema.safeParse(form)
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error))
      return
    }

    setErrors({})

    const { result: driveResult, error: driveError } = await uploadToDrive(
      file,
      'special_orders',
      {
        uploadedBy: user.role,
        entityId:   parentAttId ?? parentOrderId,
        entityType: 'special_order_attachment',
      }
    )

    if (!driveResult) {
      toast.error(driveError)
      return
    }

    onAttached({
      reference:     parsed.data.reference.trim(),
      subject:       parsed.data.subject.trim(),
      date:          parsed.data.date,
      file,
      fileName:      file.name,
      fileSizeBytes: file.size,
      mimeType:      file.type || 'application/pdf',
      gdriveFileId:  driveResult.gdriveFileId,
      gdriveUrl:     driveResult.fileUrl,
      poolAccountId: driveResult.poolAccountId,
    })

    toast.success(`"${parsed.data.reference.trim()}" attached successfully.`)
    resetAndClose()
  }

  const cls = (field: string) =>
    `w-full px-3 py-2.5 border-[1.5px] rounded-lg text-sm bg-slate-50
     focus:outline-none focus:border-blue-500 focus:bg-white transition
     disabled:opacity-50 ${
       errors[field]
         ? 'border-red-400 focus:border-red-400'
         : 'border-slate-200'
     }`

  return (
    <Modal
      open={open}
      onClose={uploading ? () => {} : resetAndClose}
      title="Attach Supporting Document"
      width="max-w-lg"
    >
      <div className="p-6 space-y-4">

        {/* Context hint */}
        <div className="flex items-start gap-2.5 px-3.5 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-blue-500 text-lg flex-shrink-0 leading-none mt-0.5">ℹ</span>
          <p className="text-xs text-blue-700 leading-relaxed">
            Provide the reference number and subject of the supporting document
            before uploading so it can be properly indexed and tracked.
          </p>
        </div>

        {/* Reference + Date */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              SO Reference <span className="text-red-500">*</span>
            </label>
            <input
              className={cls('reference')}
              value={form.reference}
              onChange={e => handleChange('reference', e.target.value)}
              placeholder="e.g. SO No. 2024-102-A"
              disabled={uploading}
            />
            {errors.reference && (
              <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.reference}</p>
            )}
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              className={cls('date')}
              value={form.date}
              onChange={e => handleChange('date', e.target.value)}
              disabled={uploading}
            />
            {errors.date && (
              <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.date}</p>
            )}
          </div>
        </div>

        {/* Subject */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Subject <span className="text-red-500">*</span>
          </label>
          <input
            className={cls('subject')}
            value={form.subject}
            onChange={e => handleChange('subject', e.target.value)}
            placeholder="e.g. Amendment — Designation of Officers Q2"
            disabled={uploading}
          />
          {errors.subject && (
            <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.subject}</p>
          )}
        </div>

        {/* File picker */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={e => handleFileChange(e.target.files?.[0] ?? null)}
        />

        {file ? (
          <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border-[1.5px] border-blue-200 rounded-xl">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl flex-shrink-0">📕</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                <p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>
            {!uploading && (
              <button
                onClick={() => {
                  setFile(null)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
                className="text-slate-400 hover:text-red-500 font-bold text-sm ml-3 flex-shrink-0 transition"
              >
                ✕
              </button>
            )}
          </div>
        ) : (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setDragging(false)
              handleFileChange(e.dataTransfer.files?.[0] ?? null)
            }}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
              transition select-none ${
                errors.file
                  ? 'border-red-400 bg-red-50'
                  : dragging
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50'
              } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
          >
            <div className="mb-2 flex justify-center text-blue-500">
              <Paperclip size={28} strokeWidth={2} />
            </div>
            <p className="text-sm font-medium text-slate-600 mb-1">
              Click to browse or drag &amp; drop
            </p>
            <p className="text-xs text-slate-400">PDF — max 50 MB</p>
          </div>
        )}

        {errors.file && (
          <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.file}</p>
        )}

        {uploading && (
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-blue-700 font-medium">Uploading to Google Drive…</p>
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-1">
          <Button variant="outline" onClick={resetAndClose} disabled={uploading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={uploading || !file}
          >
            {uploading ? 'Uploading…' : '📎 Attach File'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}