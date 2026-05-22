'use client'
// components/modals/AddUserModal.tsx (v2 — Drive Pool avatar + fetch API)

import { useState, useRef } from 'react'
import { Modal }    from '@/components/ui/Modal'
import { Button }   from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { AddUserSchema, zodErrors } from '@/lib/validations'
import { useAuth } from '@/lib/auth'
import { logAddUser } from '@/lib/adminLogger'

interface CreatedUser {
  id: string
  name: string
  email: string
  role: string
  initials: string
  avatarColor: string
  avatarUrl?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onAdd?: (user: CreatedUser) => void
}

const AVATAR_COLORS = [
  '#3b63b8', '#0e7490', '#7c3aed', '#b45309',
  '#0f766e', '#be123c', '#4338ca', '#15803d',
]

function pickAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(first: string, last: string): string {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase()
}

export function AddUserModal({ open, onClose, onAdd }: Props) {
  const { toast } = useToast()
  const { user: currentUser } = useAuth()
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [submitting, setSubmitting] = useState(false)
  const [errors,     setErrors]     = useState<Record<string, string>>({})
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string>('')

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', role: 'officer', rank: '', department: '',
  })

  const field = (key: string, value: string) => {
    setForm(p => ({ ...p, [key]: value }))
    setErrors(p => ({ ...p, [key]: '' }))
  }

  function handleAvatarChange(file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErrors(p => ({ ...p, avatar: 'Only image files are accepted.' }))
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrors(p => ({ ...p, avatar: 'Image must be under 5 MB.' }))
      return
    }
    setAvatarFile(file)
    setErrors(p => ({ ...p, avatar: '' }))
    const reader = new FileReader()
    reader.onload = e => setAvatarPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  function resetAndClose() {
    setErrors({})
    setAvatarFile(null)
    setAvatarPreview('')
    setSubmitting(false)
    setForm({ firstName: '', lastName: '', email: '', role: 'officer', rank: '', department: '' })
    if (avatarInputRef.current) avatarInputRef.current.value = ''
    onClose()
  }

  async function submit() {
    // ── Client-side validation ─────────────────────────────────────────────
    const nextErrors: Record<string, string> = {}
    if (!form.firstName.trim())  nextErrors.firstName  = 'First name is required.'
    if (!form.lastName.trim())   nextErrors.lastName   = 'Last name is required.'
    if (!form.email.trim())      nextErrors.email      = 'Email is required.'
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      nextErrors.email = 'Enter a valid email address.'
    if (!form.rank.trim())       nextErrors.rank       = 'Rank / Position is required.'
    if (!form.department.trim()) nextErrors.department = 'Department / Unit is required.'
    if (!form.role.trim())       nextErrors.role       = 'System role is required.'

    if (Object.keys(nextErrors).length > 0) { setErrors(nextErrors); return }

    const result = AddUserSchema.safeParse(form)
    if (!result.success) { setErrors(zodErrors(result.error)); return }

    setErrors({})
    setSubmitting(true)

    try {
      const fullName = `${result.data.firstName} ${result.data.lastName}`

      // ── 1. Create user via API ─────────────────────────────────────────
      const userRes = await fetch('/api/users', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:       fullName,
          email:      result.data.email,
          role:       result.data.role,
          rank:       result.data.rank,
          department: result.data.department,
        }),
      })

      const userJson = await userRes.json()

      if (!userRes.ok || !userJson.data) {
        toast.error(userJson.error ?? 'Failed to create user. Please try again.')
        return
      }

      const newUser: CreatedUser = {
        ...userJson.data,
        avatarColor: pickAvatarColor(fullName),
        initials:    getInitials(result.data.firstName, result.data.lastName),
      }

      // ── 2. Upload avatar to Drive pool (optional) ──────────────────────
      if (avatarFile) {
        const avatarForm = new FormData()
        avatarForm.append('file',     avatarFile)
        avatarForm.append('username', newUser.id)   // use the created user id as username key

        const avatarRes  = await fetch('/api/users/avatar', {
          method: 'POST',
          body:   avatarForm,
        })

        const avatarJson = await avatarRes.json()

        if (avatarRes.ok && avatarJson.data?.fileUrl) {
          newUser.avatarUrl = avatarJson.data.fileUrl
        } else {
          // Avatar upload failed — not fatal, user is still created
          console.warn('[AddUserModal] Avatar upload failed:', avatarJson.error)
          toast.error('User created, but profile photo upload failed. You can set it later.')
        }
      }

      await logAddUser(fullName, result.data.email)
      toast.success(`User "${fullName}" created. A temporary password has been sent to ${result.data.email}.`)
      onAdd?.(newUser)
      resetAndClose()
    } catch (err: any) {
      console.error('[AddUserModal]', err)
      toast.error('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const hasMissingRequired =
    !form.firstName.trim() || !form.lastName.trim() || !form.email.trim() ||
    !form.rank.trim() || !form.department.trim() || !form.role.trim()

  const cls = (f: string) =>
    `w-full px-3 py-2.5 border-[1.5px] rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition disabled:opacity-50 ${
      errors[f] ? 'border-red-400 focus:border-red-400' : 'border-slate-200'
    }`

  const previewInitials = getInitials(form.firstName || 'U', form.lastName || 'U')
  const previewColor    = pickAvatarColor(`${form.firstName} ${form.lastName}`)

  return (
    <Modal open={open} onClose={submitting ? () => {} : resetAndClose} title="Add New User" width="max-w-md">
      <div className="p-6 space-y-4">

        {/* ── Avatar picker ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-4">
          <div
            className="relative group w-16 h-16 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-lg cursor-pointer overflow-hidden border-2 border-slate-200 hover:border-blue-400 transition"
            style={{ background: avatarPreview ? 'transparent' : previewColor }}
            onClick={() => !submitting && avatarInputRef.current?.click()}
            title="Click to upload profile photo"
          >
            {avatarPreview
              ? <img src={avatarPreview} alt="preview" className="w-full h-full object-cover" />
              : <span>{previewInitials}</span>
            }
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-full">
              <span className="text-white text-xs font-bold">📷</span>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-600 mb-0.5">Profile Photo</p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Optional. Click the avatar to upload.<br />JPG, PNG, WebP — max 5 MB.
            </p>
            {avatarFile && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-[11px] text-blue-600 font-medium truncate max-w-[140px]">{avatarFile.name}</span>
                <button
                  type="button"
                  onClick={() => { setAvatarFile(null); setAvatarPreview(''); if (avatarInputRef.current) avatarInputRef.current.value = '' }}
                  className="text-slate-400 hover:text-red-500 font-bold text-xs flex-shrink-0"
                  disabled={submitting}
                >✕</button>
              </div>
            )}
            {errors.avatar && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.avatar}</p>}
          </div>

          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={e => handleAvatarChange(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="h-px bg-slate-100" />

        {/* ── Name ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              First Name <span className="text-red-500">*</span>
            </label>
            <input className={cls('firstName')} placeholder="Ana"
              value={form.firstName} onChange={e => field('firstName', e.target.value)}
              disabled={submitting} />
            {errors.firstName && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.firstName}</p>}
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input className={cls('lastName')} placeholder="Santos"
              value={form.lastName} onChange={e => field('lastName', e.target.value)}
              disabled={submitting} />
            {errors.lastName && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.lastName}</p>}
          </div>
        </div>

        {/* ── Email ────────────────────────────────────────────────────── */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Email <span className="text-red-500">*</span>
          </label>
          <input type="email" className={cls('email')} placeholder="yourname@ddnppo.gov.ph"
            value={form.email} onChange={e => field('email', e.target.value)}
            disabled={submitting} />
          {errors.email && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.email}</p>}
        </div>

        {/* ── Rank ─────────────────────────────────────────────────────── */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Rank / Position <span className="text-red-500">*</span>
          </label>
          <input className={cls('rank')} placeholder="e.g. P/Maj., P/Insp., P/Col."
            value={form.rank} onChange={e => field('rank', e.target.value)}
            disabled={submitting} />
          {errors.rank && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.rank}</p>}
        </div>

        {/* ── Department ───────────────────────────────────────────────── */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            🏢 Department / Unit <span className="text-red-500">*</span>
          </label>
          <input className={cls('department')} placeholder="e.g. Operations, Intelligence, Administration"
            value={form.department} onChange={e => field('department', e.target.value)}
            disabled={submitting} />
          {errors.department && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.department}</p>}
          {form.department && (
            <div className="mt-2 inline-block px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-full text-[11px] font-medium text-blue-700">
              📌 {form.department}
            </div>
          )}
        </div>

        {/* ── Role ─────────────────────────────────────────────────────── */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            System Role <span className="text-red-500">*</span>
          </label>
          <select className={cls('role')} value={form.role}
            onChange={e => field('role', e.target.value)} disabled={submitting}>
            <option value="officer">Officer (read only)</option>
            <option value="admin">Administrator (full access)</option>
          </select>
          {errors.role && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.role}</p>}
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          A temporary password will be sent to the user's email. They will be prompted to change it on first login.
        </p>

        {/* ── Submitting state ─────────────────────────────────────────── */}
        {submitting && (
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-blue-700 font-medium">
              {avatarFile ? 'Creating user & uploading photo…' : 'Creating user…'}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2.5 pt-1">
          <Button variant="outline" onClick={resetAndClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={hasMissingRequired || submitting}>
            {submitting ? 'Creating…' : '👤 Create User'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}