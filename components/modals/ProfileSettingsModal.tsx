'use client'
// components/modals/ProfileSettingsModal.tsx
// Micro settings panel for sidebar profile – clickable avatar opens this modal.

import { useState, useEffect, useRef } from 'react'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/lib/auth'
import type { AdminUser } from '@/lib/auth'
import { logPasswordChange } from '@/lib/adminLogger'
import {
  getStoredProfilePrefs,
  saveStoredProfilePrefs,
  uploadProfileAvatar,
} from '@/lib/profileStorage'

interface ProfileSettingsModalProps {
  open: boolean
  onClose: () => void
  user: AdminUser | null
  onProfileUpdated?: (updates: { displayName?: string; avatarUrl?: string }) => void
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

type Tab = 'profile' | 'password'

const TAB_LABELS: { id: Tab; label: string; icon: string }[] = [
  { id: 'profile',  label: 'Profile',  icon: '👤' },
  { id: 'password', label: 'Security', icon: '🔑' },
]

export function ProfileSettingsModal({
  open,
  onClose,
  user,
  onProfileUpdated,
}: ProfileSettingsModalProps) {
  const { toast } = useToast()
  const { changePassword } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modalRef     = useRef<HTMLDivElement>(null)

  const [tab,     setTab]     = useState<Tab>('profile')
  const [saving,  setSaving]  = useState(false)
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)

  // ── Profile fields ────────────────────────────────────────────────────────
  const [displayName,  setDisplayName]  = useState(user?.name ?? '')
  const [photoFile,    setPhotoFile]    = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string>('')
  const [nameError,    setNameError]    = useState('')
  // ISSUE 5 FIX: email removed from state entirely — it is displayed read-only
  // directly from user?.email. The previous editable field was a silent bug:
  // the value was never sent to supabase.auth.updateUser or the profiles table,
  // so users could "save" a new email address and nothing would actually change.
  // Email changes must be handled by a system administrator.

  // ── Password fields ───────────────────────────────────────────────────────
  const [currentPw, setCurrentPw] = useState('')
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw,    setShowPw]    = useState({ current: false, next: false, confirm: false })
  const [pwErrors,  setPwErrors]  = useState<Record<string, string>>({})

  // ── Animation lifecycle ───────────────────────────────────────────────────

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
    } else if (mounted) {
      setClosing(true)
      const t = setTimeout(() => { setMounted(false); setClosing(false) }, 200)
      return () => clearTimeout(t)
    }
  }, [open, mounted])

  // ── Reset state when opened ───────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    setTab('profile')
    void (async () => {
      const prefs = user ? await getStoredProfilePrefs(user.role) : {}
      setDisplayName(prefs.displayName ?? user?.name ?? '')
      setPhotoPreview(prefs.avatarUrl ?? user?.avatarUrl ?? '')
    })()
    setPhotoFile(null)
    setNameError('')
    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
    setPwErrors({})
    setSaving(false)
    setShowPw({ current: false, next: false, confirm: false })
  }, [open, user])

  // ── Close on Escape ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // ── Photo picker ──────────────────────────────────────────────────────────

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file.'); return }
    if (file.size > 5 * 1024 * 1024)    { toast.error('Image must be smaller than 5 MB.'); return }
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = ev => setPhotoPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  // ── Profile save ──────────────────────────────────────────────────────────

  async function handleProfileSave() {
    if (!displayName.trim()) { setNameError('Display name is required.'); return }

    setSaving(true)
    try {
      let avatarUrl: string | undefined = undefined

      if (photoFile && user) {
        const uploadedUrl = await uploadProfileAvatar(user.role, photoFile)
        if (!uploadedUrl) {
          toast.error('Photo upload failed. Please try again.')
          setSaving(false)
          return
        }
        avatarUrl = uploadedUrl
      }

      if (!avatarUrl) {
        const currentPrefs = user ? await getStoredProfilePrefs(user.role) : {}
        avatarUrl = currentPrefs.avatarUrl?.split('?')[0] ?? user?.avatarUrl ?? undefined
      }

      if (user) {
        const saved = await saveStoredProfilePrefs(user.role, {
          displayName: displayName.trim(),
          avatarUrl,
        })
        if (!saved) {
          toast.error('Profile saved locally, but cloud sync failed. Check Supabase permissions/policies.')
          return
        }
      }

      onProfileUpdated?.({ displayName: displayName.trim(), avatarUrl })
      toast.success('Profile updated successfully.')
      onClose()
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Password save ─────────────────────────────────────────────────────────

  async function handlePasswordSave() {
    const errors: Record<string, string> = {}

    if (!currentPw)
      errors.current = 'Current password is required.'

    if (!newPw)
      errors.next = 'New password is required.'
    else if (newPw.length < 12)
      errors.next = 'Password must be at least 12 characters.'

    if (!confirmPw)
      errors.confirm = 'Please confirm the new password.'
    else if (newPw !== confirmPw)
      errors.confirm = 'Passwords do not match.'

    if (newPw && currentPw && newPw === currentPw)
      errors.next = 'New password must be different from your current password.'

    setPwErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    const { error } = await changePassword(currentPw, newPw)
    setSaving(false)

    if (error) {
      if (error === 'Current password is incorrect.') {
        setPwErrors(prev => ({ ...prev, current: error }))
      } else {
        toast.error(error)
      }
      return
    }

    toast.success('Password updated successfully.')
    void logPasswordChange()
    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
  }

  // ── Password strength ─────────────────────────────────────────────────────

  const pwStrength = newPw.length >= 20 ? 4
    : newPw.length >= 16 ? 3
    : newPw.length >= 12 ? 2
    : newPw.length > 0   ? 1
    : 0
  const pwStrengthColors = ['', 'bg-red-400', 'bg-amber-400', 'bg-blue-500', 'bg-emerald-500']
  const pwStrengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong']

  if (!mounted) return null

  const fieldCls = (err?: string) =>
    `w-full px-3 py-2.5 border-[1.5px] rounded-xl text-sm bg-slate-50 focus:outline-none focus:bg-white transition ${
      err ? 'border-red-400 focus:border-red-400' : 'border-slate-200 focus:border-blue-500'
    }`

  // Read-only field — same visual weight as the System Role display box
  const readOnlyFieldCls =
    'w-full px-3 py-2.5 border-[1.5px] border-slate-100 rounded-xl text-sm bg-slate-50 text-slate-400 flex items-center gap-2'

  const avatarBg = user?.avatarColor ?? '#3b63b8'
  const initials = displayName ? getInitials(displayName) : (user?.initials ?? '??')

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[1050] bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
          closing ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={modalRef}
        onClick={e => e.stopPropagation()}
        className={`fixed top-0 left-0 z-[1060] transition-all duration-200 ${
          closing
            ? 'opacity-0 translate-y-2 scale-[0.98]'
            : 'opacity-100 translate-y-0 scale-100'
        }`}
        style={{ left: '252px', top: '16px', bottom: '16px', width: '360px', maxHeight: 'calc(100vh - 32px)' }}
      >
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-32px)]">

          {/* ── Header ── */}
          <div className="bg-[#0f1c35] px-5 py-4 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="relative group flex-shrink-0">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-[15px] border-2 border-white/20 overflow-hidden cursor-pointer transition-opacity hover:opacity-80"
                  style={{ background: photoPreview ? 'transparent' : avatarBg }}
                  onClick={() => !saving && fileInputRef.current?.click()}
                  title="Click to change photo"
                >
                  {photoPreview
                    ? <img src={photoPreview} alt="preview" className="w-full h-full object-cover" />
                    : initials}
                </div>
                <div
                  className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity"
                  onClick={() => !saving && fileInputRef.current?.click()}
                >
                  <span className="text-white text-[10px] font-bold">📷</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-white text-[14px] font-bold leading-tight truncate">{displayName || user?.name}</p>
                <p className="text-white/50 text-[11px] capitalize mt-0.5">{user?.role} · {user?.title}</p>
              </div>

              <button
                onClick={onClose}
                className="text-white/40 hover:text-white/80 transition p-1 rounded-lg hover:bg-white/10 flex-shrink-0"
                title="Close"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <p className="text-white/30 text-[10px] mt-2.5 flex items-center gap-1">
              <span>📷</span> Click your avatar above to change profile photo (max 5 MB)
            </p>
          </div>

          {/* ── Tab Bar ── */}
          <div className="flex border-b border-slate-100 flex-shrink-0">
            {TAB_LABELS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold uppercase tracking-wide transition border-b-2 ${
                  tab === t.id
                    ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                    : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>

          {/* ── Scrollable body ── */}
          <div className="flex-1 overflow-y-auto">

            {/* ══════════════════════════════════════
                PROFILE TAB
            ══════════════════════════════════════ */}
            {tab === 'profile' && (
              <div className="p-5 space-y-4">

                {/* Display name — editable */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                    Display Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    className={fieldCls(nameError)}
                    value={displayName}
                    onChange={e => { setDisplayName(e.target.value); setNameError('') }}
                    placeholder="e.g. Ramon Dela Cruz"
                    disabled={saving}
                  />
                  {nameError && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {nameError}</p>}
                  <p className="text-[10px] text-slate-400 mt-1">Updates your sidebar display name only.</p>
                </div>

                {/* Email — read-only (ISSUE 5 FIX) */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                    Email Address <span className="text-[10px] text-slate-400 normal-case">(read-only)</span>
                  </label>
                  <div className={readOnlyFieldCls}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-slate-300">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    <span className="truncate">{user?.email ?? '—'}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Email changes must be requested from your system administrator.
                  </p>
                </div>

                {/* System role — read-only */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                    System Role <span className="text-[10px] text-slate-400 normal-case">(read-only)</span>
                  </label>
                  <div className="w-full px-3 py-2.5 border-[1.5px] border-slate-100 rounded-xl text-sm bg-slate-50 text-slate-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: user?.avatarColor }} />
                    <span className="capitalize font-medium">{user?.role}</span>
                    <span className="text-slate-300 mx-1">·</span>
                    <span className="truncate">{user?.title}</span>
                  </div>
                </div>

                {/* Photo picker */}
                {photoFile ? (
                  <div className="flex items-center gap-3 px-3 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-blue-200 flex-shrink-0">
                      {photoPreview
                        ? <img src={photoPreview} alt="preview" className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-slate-200" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">{photoFile.name}</p>
                      <p className="text-[10px] text-slate-400">{(photoFile.size / 1024 / 1024).toFixed(2)} MB · Will sync across devices</p>
                    </div>
                    <button
                      onClick={() => {
                        setPhotoFile(null)
                        void getStoredProfilePrefs(user!.role).then(p => {
                          setPhotoPreview(p.avatarUrl ?? user?.avatarUrl ?? '')
                        })
                        if (fileInputRef.current) fileInputRef.current.value = ''
                      }}
                      className="text-slate-400 hover:text-red-500 font-bold text-sm transition"
                    >✕</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => !saving && fileInputRef.current?.click()}
                    disabled={saving}
                    className="w-full flex items-center gap-3 px-4 py-3 border-2 border-dashed border-slate-200 hover:border-blue-400 hover:bg-blue-50 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed text-left"
                  >
                    <span className="text-2xl">📷</span>
                    <div>
                      <p className="text-sm font-medium text-slate-600">Change profile photo</p>
                      <p className="text-[11px] text-slate-400">JPG, PNG, WebP — max 5 MB · Synced across all devices</p>
                    </div>
                  </button>
                )}

                {saving && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <p className="text-sm font-medium text-blue-700">Saving &amp; syncing across devices…</p>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button onClick={onClose} disabled={saving}
                    className="flex-1 px-4 py-2.5 border-[1.5px] border-slate-200 text-slate-600 font-semibold text-sm rounded-xl hover:bg-slate-50 transition disabled:opacity-60">
                    Cancel
                  </button>
                  <button onClick={handleProfileSave} disabled={saving}
                    className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition disabled:opacity-60 flex items-center justify-center gap-2">
                    {saving
                      ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
                      : '💾 Save Changes'}
                  </button>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════
                SECURITY TAB
            ══════════════════════════════════════ */}
            {tab === 'password' && (
              <div className="p-5 space-y-4">

                <div className="flex items-start gap-2 px-3 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                  <span className="flex-shrink-0 mt-0.5">⚠️</span>
                  <span>Use a strong password (min. 12 characters, mix of upper/lower, numbers &amp; symbols). You remain logged in after changing.</span>
                </div>

                {/* Current password */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                    Current Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPw.current ? 'text' : 'password'}
                      className={`${fieldCls(pwErrors.current)} pr-10`}
                      placeholder="Enter current password"
                      value={currentPw}
                      onChange={e => { setCurrentPw(e.target.value); setPwErrors(p => ({ ...p, current: '' })) }}
                      disabled={saving}
                    />
                    <button type="button" onClick={() => setShowPw(s => ({ ...s, current: !s.current }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">
                      {showPw.current ? '🙈' : '👁'}
                    </button>
                  </div>
                  {pwErrors.current && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {pwErrors.current}</p>}
                </div>

                {/* New password */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                    New Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPw.next ? 'text' : 'password'}
                      className={`${fieldCls(pwErrors.next)} pr-10`}
                      placeholder="Min. 12 characters"
                      value={newPw}
                      onChange={e => { setNewPw(e.target.value); setPwErrors(p => ({ ...p, next: '' })) }}
                      disabled={saving}
                    />
                    <button type="button" onClick={() => setShowPw(s => ({ ...s, next: !s.next }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">
                      {showPw.next ? '🙈' : '👁'}
                    </button>
                  </div>
                  {newPw && (
                    <div className="mt-1.5 space-y-1">
                      <div className="flex gap-1">
                        {[1,2,3,4].map(i => (
                          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${pwStrength >= i ? pwStrengthColors[pwStrength] : 'bg-slate-200'}`} />
                        ))}
                      </div>
                      <p className={`text-[10px] font-semibold ${['','text-red-500','text-amber-500','text-blue-500','text-emerald-500'][pwStrength]}`}>
                        {pwStrengthLabels[pwStrength]}
                      </p>
                    </div>
                  )}
                  {pwErrors.next && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {pwErrors.next}</p>}
                </div>

                {/* Confirm password */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                    Confirm Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPw.confirm ? 'text' : 'password'}
                      className={`${fieldCls(pwErrors.confirm)} pr-10`}
                      placeholder="Repeat new password"
                      value={confirmPw}
                      onChange={e => { setConfirmPw(e.target.value); setPwErrors(p => ({ ...p, confirm: '' })) }}
                      disabled={saving}
                    />
                    <button type="button" onClick={() => setShowPw(s => ({ ...s, confirm: !s.confirm }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">
                      {showPw.confirm ? '🙈' : '👁'}
                    </button>
                  </div>
                  {confirmPw && newPw === confirmPw && (
                    <p className="text-xs text-emerald-600 mt-1 font-medium">✅ Passwords match</p>
                  )}
                  {pwErrors.confirm && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {pwErrors.confirm}</p>}
                </div>

                {saving && (
                  <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <p className="text-sm font-medium text-blue-700">Updating password…</p>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button onClick={onClose} disabled={saving}
                    className="flex-1 px-4 py-2.5 border-[1.5px] border-slate-200 text-slate-600 font-semibold text-sm rounded-xl hover:bg-slate-50 transition disabled:opacity-60">
                    Cancel
                  </button>
                  <button onClick={handlePasswordSave} disabled={saving}
                    className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition disabled:opacity-60 flex items-center justify-center gap-2">
                    {saving
                      ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Updating…</>
                      : '🔑 Update Password'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="flex-shrink-0 px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
            <p className="text-[10px] text-slate-400">
              Logged in as <span className="font-bold text-slate-600">{user?.role}</span>
            </p>
            <p className="text-[10px] text-slate-300">Profile synced across devices</p>
          </div>

        </div>
      </div>
    </>
  )
}