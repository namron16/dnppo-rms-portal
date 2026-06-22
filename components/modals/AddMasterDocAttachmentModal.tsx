'use client'
// components/modals/AddMasterDocAttachmentModal.tsx
//
// Shown when a user clicks "+ Attach file" on a Master Document.
// Collects metadata (level, title, tag, date) before uploading the file
// so every attachment is properly labelled.
//
// PNP workflow:
//   Regional file uploaded first → Provincial file attached to it → Station
//   file attached as response. Each level is a child of the one above.

import { useState, useRef } from 'react'
import { Modal }    from '@/components/ui/Modal'
import { Button }   from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useAuth }  from '@/lib/auth'
import { useDriveUpload } from '@/hooks/useGDriveTool'
import { z } from 'zod'
import { zodErrors } from '@/lib/validations'
import { Paperclip } from 'lucide-react'
import type { AdminRole } from '@/lib/auth'

// ── Schema ────────────────────────────────────────────────────────────────────

const AttachmentSchema = z.object({
  title: z
    .string()
    .min(1, 'Attachment title is required.')
    .max(200, 'Title must be 200 characters or less.'),
  level: z.enum(['REGIONAL', 'PROVINCIAL', 'STATION']),
  tag:   z.enum(['COMPLIANCE', 'DIRECTIVE', 'CIRCULAR', 'MEMORANDUM']),
  date:  z.string().min(1, 'Date is required.'),
})

type AttachmentInput = z.infer<typeof AttachmentSchema>

// ── Result returned to the parent ─────────────────────────────────────────────

export interface AttachmentUploadResult {
  title:          string
  level:          'REGIONAL' | 'PROVINCIAL' | 'STATION'
  tag:            string
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
  /** Called after a successful upload with full metadata + Drive result. */
  onAttached:   (result: AttachmentUploadResult) => void
  /** ID of the parent master document — used as entityId for Drive upload. */
  parentDocId:  string
  /** ID of the parent attachment (if attaching to an attachment, not root doc). */
  parentAttId?: string | null
  /**
   * Suggested default level based on hierarchy:
   * If parent is REGIONAL → suggest PROVINCIAL, etc.
   */
  suggestedLevel?: 'REGIONAL' | 'PROVINCIAL' | 'STATION'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AddMasterDocAttachmentModal({
  open,
  onClose,
  onAttached,
  parentDocId,
  parentAttId,
  suggestedLevel = 'PROVINCIAL',
}: Props) {
  const { toast }  = useToast()
  const { user }   = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const today = new Date().toISOString().split('T')[0]

  const { uploadToDrive, uploading } = useDriveUpload()

  const [file,     setFile]     = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [errors,   setErrors]   = useState<Record<string, string>>({})

  const [form, setForm] = useState<AttachmentInput>({
    title: '',
    level: suggestedLevel,
    tag:   'COMPLIANCE',
    date:  today,
  })

  // Re-apply suggested level when it changes (e.g. parent changes)
  // We don't do this inside render to avoid resetting user edits mid-session
  const prevOpen = useRef(false)
  if (open && !prevOpen.current) {
    // Modal just opened — reset form
    setTimeout(() => {
      setForm({ title: '', level: suggestedLevel, tag: 'COMPLIANCE', date: today })
      setErrors({})
      setFile(null)
    }, 0)
  }
  prevOpen.current = open

  function handleChange(key: keyof AttachmentInput, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
    setErrors(prev => ({ ...prev, [key]: '' }))
  }

  function handleFileChange(incoming: File | null) {
    if (!incoming) return
    setFile(incoming)
    setErrors(prev => ({ ...prev, file: '' }))
    // Auto-fill title from filename if empty
    setForm(prev =>
      prev.title
        ? prev
        : { ...prev, title: incoming.name.replace(/\.[^/.]+$/, '') }
    )
  }

  function resetAndClose() {
    setForm({ title: '', level: suggestedLevel, tag: 'COMPLIANCE', date: today })
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

    const parsed = AttachmentSchema.safeParse(form)
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error))
      return
    }

    setErrors({})

    const { result: driveResult, error: driveError } = await uploadToDrive(
      file,
      'master_documents',
      {
        uploadedBy: user.role,
        entityId:   parentAttId ?? parentDocId,
        entityType: 'master_document_attachment',
      }
    )

    if (!driveResult) {
      toast.error(driveError)
      return
    }

    onAttached({
      title:         parsed.data.title.trim(),
      level:         parsed.data.level,
      tag:           parsed.data.tag,
      date:          parsed.data.date,
      file,
      fileName:      file.name,
      fileSizeBytes: file.size,
      mimeType:      file.type || 'application/pdf',
      gdriveFileId:  driveResult.gdriveFileId,
      gdriveUrl:     driveResult.fileUrl,
      poolAccountId: driveResult.poolAccountId,
    })

    toast.success(`"${parsed.data.title.trim()}" attached successfully.`)
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

  const LEVEL_LABELS: Record<string, string> = {
    REGIONAL:   'Regional',
    PROVINCIAL: 'Provincial',
    STATION:    'Station',
  }

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
            Attachments follow the PNP hierarchy: Regional → Provincial → Station.
            Fill in the details for this supporting document before uploading.
          </p>
        </div>

        {/* Title */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Document Title <span className="text-red-500">*</span>
          </label>
          <input
            className={cls('title')}
            value={form.title}
            onChange={e => handleChange('title', e.target.value)}
            placeholder="e.g. Provincial Memorandum No. 2024-01"
            disabled={uploading}
          />
          {errors.title && (
            <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.title}</p>
          )}
        </div>

        {/* Level + Tag */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Level <span className="text-red-500">*</span>
            </label>
            <select
              className={cls('level')}
              value={form.level}
              onChange={e => handleChange('level', e.target.value)}
              disabled={uploading}
            >
              {(['REGIONAL', 'PROVINCIAL', 'STATION'] as const).map(l => (
                <option key={l} value={l}>{LEVEL_LABELS[l]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Tag
            </label>
            <select
              className={cls('tag')}
              value={form.tag}
              onChange={e => handleChange('tag', e.target.value)}
              disabled={uploading}
            >
              <option value="COMPLIANCE">Compliance</option>
              <option value="DIRECTIVE">Directive</option>
              <option value="CIRCULAR">Circular</option>
              <option value="MEMORANDUM">Memorandum</option>
            </select>
          </div>
        </div>

        {/* Date */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Document Date <span className="text-red-500">*</span>
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