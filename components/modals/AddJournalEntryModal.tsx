'use client'
// components/modals/AddJournalEntryModal.tsx
// FIX: passes uploaded_by (user.role) back through onSubmit so the page
//      can tag the journal entry and filter by user on next load.

import { useEffect, useRef, useState } from 'react'
import { Modal }    from '@/components/ui/Modal'
import { Button }   from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { Paperclip } from 'lucide-react'
import { AddJournalEntrySchema, zodErrors, type AddJournalEntryInput } from '@/lib/validations'
import { useDriveUpload } from '@/hooks/useGDriveTool'
import { useAuth } from '@/lib/auth'

type JournalEntryFormInput = AddJournalEntryInput & { file?: File }
type JournalFormState = {
  title: string
  type: AddJournalEntryInput['type']
  author: string
  date: string
  content: string
}

const OFFICE_FILE_PATTERN = /\.(doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp)(\?|$)/i
const TEXT_FILE_PATTERN   = /\.(txt|csv|md|json|xml|html?|rtf)(\?|$)/i

function getFilePreviewKind(fileName: string, mimeType = '') {
  if (mimeType.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?|$)/i.test(fileName)) return 'image'
  if (mimeType === 'application/pdf' || /\.pdf(\?|$)/i.test(fileName)) return 'pdf'
  if (mimeType.startsWith('text/') || TEXT_FILE_PATTERN.test(fileName) || mimeType.includes('json') || mimeType.includes('xml')) return 'text'
  if (mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)(\?|$)/i.test(fileName)) return 'audio'
  if (mimeType.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi)(\?|$)/i.test(fileName)) return 'video'
  if (OFFICE_FILE_PATTERN.test(fileName)) return 'office'
  return 'download'
}

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  submitLabel?: string
  initialValue?: Partial<AddJournalEntryInput> & { content?: string; fileUrl?: string }
  // FIX: onSubmit now also receives uploaded_by so the page can persist it
  onSubmit?: (entry: JournalEntryFormInput & { driveFileUrl?: string; uploaded_by?: string }) => void | Promise<void>
}

const getTodayDate = () => new Date().toISOString().split('T')[0]
const EMPTY_FORM: JournalFormState = { title: '', type: 'MEMO', author: '', date: '', content: '' }

export function AddJournalEntryModal({
  open,
  onClose,
  title = 'New Journal Entry',
  submitLabel = '✅ Create Entry',
  initialValue,
  onSubmit,
}: Props) {
  const { toast } = useToast()
  const { user }  = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { uploadToDrive, uploading, error: uploadError } = useDriveUpload()

  const [errors, setErrors]           = useState<Record<string, string>>({})
  const [form, setForm]               = useState<JournalFormState>(EMPTY_FORM)
  const [file, setFile]               = useState<File | null>(null)
  const [previewUrl, setPreviewUrl]   = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const hasExistingFile               = !!initialValue?.fileUrl

  useEffect(() => {
    if (!file) { setPreviewUrl(''); setPreviewOpen(false); return }
    const objectUrl = URL.createObjectURL(file)
    setPreviewUrl(objectUrl)
    return () => { URL.revokeObjectURL(objectUrl) }
  }, [file])

  useEffect(() => {
    if (!open) return
    setErrors({})
    setFile(null)
    setForm({
      title:   initialValue?.title   ?? '',
      type:    initialValue?.type    ?? 'MEMO',
      author:  initialValue?.author  ?? '',
      date:    initialValue?.date    ?? getTodayDate(),
      content: initialValue?.content ?? '',
    })
  }, [initialValue, open])

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
    setErrors({})
    setForm(EMPTY_FORM)
    setFile(null)
    setPreviewOpen(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    onClose()
  }

  async function submit() {
    const result = AddJournalEntrySchema.safeParse(form)
    if (!result.success) {
      setErrors(zodErrors(result.error))
      return
    }
    if (!file && !hasExistingFile) {
      setErrors(prev => ({ ...prev, file: 'Attachment is required.' }))
      return
    }
    setErrors({})

    try {
      let driveFileUrl: string | undefined

      if (file) {
        const journalId = `jnl-${Date.now()}`

        const uploadResult = await uploadToDrive(file, 'daily_journals', {
          uploadedBy: user?.role ?? 'unknown',
          entityId:   journalId,
          entityType: 'daily_journal',
        })

        if (!uploadResult) {
          toast.error(uploadError ?? 'File upload failed. Please try again.')
          return
        }

        driveFileUrl = uploadResult.fileUrl
      }

      // FIX: pass uploaded_by so the page can persist and filter by it
      await onSubmit?.({
        ...result.data,
        file:         file ?? undefined,
        driveFileUrl,
        uploaded_by:  user?.role,
      })

      toast.success(`Journal entry "${result.data.title}" saved.`)
      resetAndClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save journal entry. Please try again.'
      toast.error(message)
    }
  }

  const hasMissingRequired =
    !form.title.trim()  ||
    !form.author.trim() ||
    !form.date.trim()   ||
    (!file && !hasExistingFile)

  const cls = (f: string) =>
    `w-full px-3 py-2.5 border-[1.5px] rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition ${
      errors[f] ? 'border-red-400 focus:border-red-400' : 'border-slate-200'
    }`

  return (
    <Modal open={open} onClose={resetAndClose} title={title} width="max-w-lg">
      <div className="p-6 space-y-4">

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Title <span className="text-red-500">*</span>
          </label>
          <input className={cls('title')} placeholder="e.g. Daily Operations Update – 16 Mar"
            value={form.title} onChange={e => field('title', e.target.value)} disabled={uploading} />
          {errors.title && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.title}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Type</label>
            <select className={cls('type')} value={form.type} onChange={e => field('type', e.target.value)} disabled={uploading}>
              <option>MEMO</option><option>REPORT</option><option>LOG</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Date <span className="text-red-500">*</span>
            </label>
            <input type="date" className={cls('date')} value={form.date} onChange={e => field('date', e.target.value)} disabled={uploading} />
            {errors.date && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.date}</p>}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Author <span className="text-red-500">*</span>
          </label>
          <input className={cls('author')} placeholder="e.g. P/Col. Dela Cruz"
            value={form.author} onChange={e => field('author', e.target.value)} disabled={uploading} />
          {errors.author && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.author}</p>}
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Attachment <span className="text-red-500">*</span>
          </label>
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
                <Paperclip size={24} strokeWidth={2.1} className="flex-shrink-0 text-slate-500" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                  <p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
              <div className="ml-3 flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="text-xs font-semibold text-blue-700 hover:text-blue-800 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-white transition"
                  disabled={uploading}
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                  className="text-slate-400 hover:text-red-500 font-bold text-sm"
                  disabled={uploading}
                >
                  ✕
                </button>
              </div>
            </div>
          ) : hasExistingFile ? (
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-[1.5px] border-slate-200 rounded-xl">
              <div className="flex items-center gap-3 min-w-0">
                <Paperclip size={24} strokeWidth={2.1} className="flex-shrink-0 text-slate-500" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">Current attachment on record</p>
                  <p className="text-xs text-slate-400">Select a new file only if you want to replace it.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-semibold text-blue-700 hover:text-blue-800 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-white transition"
              >
                Replace
              </button>
            </div>
          ) : (
            <div
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
                errors.file ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50'
              } ${uploading ? 'pointer-events-none opacity-50' : ''}`}
            >
              <div className="mb-1.5 flex justify-center text-blue-600">
                <Paperclip size={28} strokeWidth={2.1} />
              </div>
              <p className="text-sm font-medium text-slate-600 mb-0.5">Attach file</p>
              <p className="text-xs text-slate-400">PDF, JPG — max 50 MB</p>
            </div>
          )}
          {errors.file && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.file}</p>}
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Content</label>
          <textarea rows={4} className={`${cls('content')} resize-none`}
            placeholder="Enter the full content of this journal entry…"
            value={form.content} onChange={e => field('content', e.target.value)}
            disabled={uploading} />
          {errors.content && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.content}</p>}
        </div>

        {uploading && (
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-blue-700 font-medium">Uploading to Google Drive…</p>
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-1">
          <Button variant="outline" onClick={resetAndClose} disabled={uploading}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={hasMissingRequired || uploading}>{submitLabel}</Button>
        </div>
      </div>

      {/* File preview sub-modal */}
      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={file ? `Preview: ${file.name}` : 'Attachment Preview'} width="max-w-5xl">
        <div className="p-6 space-y-4">
          {file ? (
            <>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">File</p>
                <p className="text-sm font-semibold text-slate-800 break-words">{file.name}</p>
                <p className="text-xs text-slate-500 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>

              {getFilePreviewKind(file.name, file.type) === 'image' ? (
                <div className="flex justify-center rounded-xl border border-slate-200 bg-white p-4">
                  <img src={previewUrl} alt={file.name} className="max-h-[70vh] max-w-full object-contain rounded-lg" />
                </div>
              ) : getFilePreviewKind(file.name, file.type) === 'pdf' ? (
                <iframe src={previewUrl} title={file.name} className="h-[75vh] w-full rounded-xl border border-slate-200 bg-white" />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
                  <p className="font-medium text-slate-800 mb-2">Preview not available for this file type before upload.</p>
                  <a href={previewUrl} download={file.name} className="text-blue-700 font-semibold hover:underline">Download file</a>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">No attachment selected.</div>
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
          </div>
        </div>
      </Modal>
    </Modal>
  )
}