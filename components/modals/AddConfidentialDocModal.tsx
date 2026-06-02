'use client'
// components/modals/AddConfidentialDocModal.tsx
//
// FIX: uploadResult now persists gdrive_file_id and pool_account_id to the doc
// so that delete and archive operations can actually reach the Drive file.

import { useState, useRef } from 'react'
import { Modal }    from '@/components/ui/Modal'
import { Button }   from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { AddConfidentialDocSchema, zodErrors } from '@/lib/validations'
import { useDriveUpload } from '@/hooks/useGDriveTool'
import { useAuth } from '@/lib/auth'
import type { ConfidentialDoc } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  onAdd?: (doc: ConfidentialDoc & {
    fileUrl?: string
    passwordHash?: string
    gdrive_file_id?: string
    gdrive_url?: string
    pool_account_id?: string
  }) => void
}

async function hashPassword(password: string): Promise<string> {
  const encoder    = new TextEncoder()
  const data       = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray  = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export function AddConfidentialDocModal({ open, onClose, onAdd }: Props) {
  const { toast }    = useToast()
  const { user }     = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const today = new Date().toISOString().split('T')[0]

  const { uploadToDrive, uploading, error: uploadError } = useDriveUpload()

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragging, setDragging]         = useState(false)
  const [show, setShow]                 = useState(false)
  const [errors, setErrors]             = useState<Record<string, string>>({})

  const [form, setForm] = useState({
    title: '', classification: 'RESTRICTED', access: 'All w/ Password',
    date: today, password: '', confirmPassword: '',
  })

  const field = (k: string, v: string) => {
    setForm(p => ({ ...p, [k]: v }))
    setErrors(p => ({ ...p, [k]: '' }))
  }

  function handleSelectedFile(file: File | null) {
    if (!file) return
    setSelectedFile(file)
    setErrors(prev => ({ ...prev, file: '' }))
  }

  function resetAndClose() {
    setForm({ title: '', classification: 'RESTRICTED', access: 'All w/ Password', date: today, password: '', confirmPassword: '' })
    setErrors({})
    setSelectedFile(null)
    setShow(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    onClose()
  }

  async function submit() {
    const result = AddConfidentialDocSchema.safeParse(form)
    if (!result.success) {
      setErrors(zodErrors(result.error))
      return
    }

    if (!selectedFile) {
      setErrors(prev => ({ ...prev, file: 'Attachment is required.' }))
      return
    }

    setErrors({})

    try {
      const passwordHash = await hashPassword(result.data.password)
      const docId = `cd-${Date.now()}`

      const uploadResult = await uploadToDrive(selectedFile, 'classified_documents', {
        uploadedBy: user?.role ?? 'unknown',
        entityId:   docId,
        entityType: 'classified_document',
      })

      if (!uploadResult) {
        toast.error(uploadError ?? 'File upload failed. Please try again.')
        return
      }

      // FIX: persist all three Drive identifiers so delete/archive can use them.
      // Previously only fileUrl was carried forward; gdrive_file_id and
      // pool_account_id were silently dropped, breaking Drive cleanup.
      const fileUrl       = typeof uploadResult === 'string' ? uploadResult : uploadResult.fileUrl
      const gdriveFileId  = typeof uploadResult === 'object' ? uploadResult.gdriveFileId  : undefined
      const poolAccountId = typeof uploadResult === 'object' ? uploadResult.poolAccountId : undefined

      const newDoc = {
        id:             docId,
        title:          result.data.title,
        classification: result.data.classification as 'RESTRICTED' | 'CONFIDENTIAL',
        date:           result.data.date,
        access:         result.data.access,
        fileUrl,
        passwordHash,
        // FIX: these two were missing before
        gdrive_file_id:  gdriveFileId,
        gdrive_url:      fileUrl,
        pool_account_id: poolAccountId,
      }

      toast.success(`Confidential document "${result.data.title}" added.`)
      onAdd?.(newDoc)
      resetAndClose()
    } catch (err) {
      console.error(err)
      toast.error('Something went wrong. Please try again.')
    }
  }

  const cls = (f: string) =>
    `w-full px-3 py-2.5 border-[1.5px] rounded-lg text-sm bg-slate-50 focus:outline-none focus:bg-white transition ${
      errors[f] ? 'border-red-400 focus:border-red-400' : 'border-slate-200 focus:border-blue-500'
    }`

  return (
    <Modal open={open} onClose={uploading ? () => {} : resetAndClose} title="Add Confidential Document" width="max-w-lg">
      <div className="p-6 space-y-4">

        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
          <span className="flex-shrink-0">⚠️</span>
          Each confidential document requires its own unique password set by the administrator.
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Document Title <span className="text-red-500">*</span>
          </label>
          <input className={cls('title')} placeholder="e.g. Intelligence Report Alpha-8"
            value={form.title} onChange={e => field('title', e.target.value)} disabled={uploading} />
          {errors.title && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.title}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Classification</label>
            <select className={cls('classification')} value={form.classification}
              onChange={e => field('classification', e.target.value)} disabled={uploading}>
              <option value="RESTRICTED">Restricted</option>
              <option value="CONFIDENTIAL">Confidential</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Date <span className="text-red-500">*</span>
            </label>
            <input type="date" className={cls('date')} value={form.date}
              onChange={e => field('date', e.target.value)} disabled={uploading} />
            {errors.date && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.date}</p>}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Access Level</label>
          <select className={cls('access')} value={form.access}
            onChange={e => field('access', e.target.value)} disabled={uploading}>
            <option value="All w/ Password">All w/ Password</option>
            <option value="Admin Only">Admin Only</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Document Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input type={show ? 'text' : 'password'} className={`${cls('password')} pr-10`}
                placeholder="Min. 6 characters"
                value={form.password} onChange={e => field('password', e.target.value)}
                disabled={uploading} />
              <button type="button" onClick={() => setShow(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">
                {show ? '🙈' : '👁'}
              </button>
            </div>
            {errors.password && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.password}</p>}
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Confirm Password <span className="text-red-500">*</span>
            </label>
            <input type={show ? 'text' : 'password'} className={cls('confirmPassword')}
              placeholder="Repeat password"
              value={form.confirmPassword} onChange={e => field('confirmPassword', e.target.value)}
              disabled={uploading} />
            {errors.confirmPassword && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.confirmPassword}</p>}
          </div>
        </div>

        <input ref={fileInputRef} type="file"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
          className="hidden"
          onChange={e => handleSelectedFile(e.target.files?.[0] ?? null)} />

        {selectedFile ? (
          <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-[1.5px] border-red-200 rounded-xl">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl flex-shrink-0">🔒</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{selectedFile.name}</p>
                <p className="text-xs text-slate-400">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>
            {!uploading && (
              <button onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                className="text-slate-400 hover:text-red-500 font-bold text-sm transition ml-3 flex-shrink-0">✕</button>
            )}
          </div>
        ) : (
          <div onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleSelectedFile(e.dataTransfer.files?.[0] ?? null) }}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
              errors.file
                ? 'border-red-400 bg-red-50'
                : dragging
                  ? 'border-red-400 bg-red-50'
                  : 'border-slate-200 hover:border-red-400 hover:bg-red-50'
            }`}>
            <div className="text-2xl mb-1.5">🔒</div>
            <p className="text-sm font-medium text-slate-600 mb-0.5">Attach confidential document</p>
            <p className="text-xs text-slate-400">File will be stored securely in Google Drive</p>
          </div>
        )}

        {errors.file && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.file}</p>}

        {uploading && (
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-blue-700 font-medium">Uploading securely to Google Drive…</p>
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-1">
          <Button variant="outline" onClick={resetAndClose} disabled={uploading}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={uploading || !selectedFile}>
            {uploading ? 'Uploading…' : '🔒 Add & Encrypt'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}