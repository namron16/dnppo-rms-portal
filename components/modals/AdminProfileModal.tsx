'use client'
// components/ui/AdminProfileModal.tsx

import { useState, useEffect, useRef } from 'react'
import { useToast } from '@/components/ui/Toast'

interface AdminProfileModalProps {
  open: boolean
  onClose: () => void
  user: {
    name: string
    email: string
    role: string
    initials: string
    avatarColor: string
  } | null
  anchorRef?: React.RefObject<HTMLElement>
}

type Tab = 'profile' | 'password'

export function AdminProfileModal({ open, onClose, user }: AdminProfileModalProps) {
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('profile')
  const [saving, setSaving] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  const [profileForm, setProfileForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    role: user?.role ?? '',
  })

  const [passwordForm, setPasswordForm] = useState({
    current: '',
    next: '',
    confirm: '',
  })
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    next: false,
    confirm: false,
  })
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (user && open) {
      setProfileForm({ name: user.name, email: user.email, role: user.role })
      setPasswordForm({ current: '', next: '', confirm: '' })
      setPasswordErrors({})
      setTab('profile')
    }
  }, [user, open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open || !user) return null

  async function handleSaveProfile() {
    if (!profileForm.name.trim()) {
      toast.error('Name cannot be empty.')
      return
    }
    setSaving(true)
    // Simulate API call
    await new Promise(r => setTimeout(r, 700))
    toast.success('Profile updated successfully.')
    setSaving(false)
  }

  function handleChangePassword() {
    const errors: Record<string, string> = {}
    if (!passwordForm.current) errors.current = 'Current password is required.'
    if (!passwordForm.next) errors.next = 'New password is required.'
    else if (passwordForm.next.length < 6) errors.next = 'Password must be at least 6 characters.'
    if (!passwordForm.confirm) errors.confirm = 'Please confirm your new password.'
    else if (passwordForm.next !== passwordForm.confirm) errors.confirm = 'Passwords do not match.'

    setPasswordErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    setTimeout(() => {
      setSaving(false)
      toast.success('Password changed successfully.')
      setPasswordForm({ current: '', next: '', confirm: '' })
      setPasswordErrors({})
    }, 800)
  }

  const inputCls = (field?: string) =>
    `w-full px-3 py-2.5 border-[1.5px] rounded-xl text-sm bg-slate-50 focus:outline-none focus:bg-white transition ${
      field && passwordErrors[field]
        ? 'border-red-400 focus:border-red-400'
        : 'border-slate-200 focus:border-blue-500'
    }`

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[1050]"
        onClick={onClose}
      />

      {/* Modal — positioned near bottom-left (sidebar area) */}
      <div
        ref={modalRef}
        className="fixed z-[1060] animate-fade-up inset-x-4 bottom-4 md:inset-x-auto md:left-[248px] md:w-[340px]"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">

          {/* Header */}
          <div className="bg-[#0f1c35] px-5 py-4 flex items-center gap-3.5 flex-shrink-0">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-[15px] font-bold flex-shrink-0 border-2 border-white/20"
              style={{ background: user.avatarColor, color: '#0f1c35' }}
            >
              {user.initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-[13px] font-bold truncate">{user.name}</p>
              <p className="text-white/50 text-[11px] capitalize">{user.role}</p>
            </div>
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white/80 transition p-1 flex-shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-100 flex-shrink-0">
            {(['profile', 'password'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition border-b-2 ${
                  tab === t
                    ? 'border-blue-600 text-blue-700 bg-blue-50/50'
                    : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t === 'profile' ? '👤 Profile' : '🔑 Password'}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ maxHeight: '420px' }}>

            {tab === 'profile' && (
              <>
                {/* Avatar preview */}
                <div className="flex items-center gap-3 px-3 py-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-bold flex-shrink-0"
                    style={{ background: user.avatarColor, color: '#0f1c35' }}
                  >
                    {profileForm.name ? profileForm.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : user.initials}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-700">{profileForm.name || 'Your Name'}</p>
                    <p className="text-[11px] text-slate-400 capitalize">{profileForm.role}</p>
                  </div>
                </div>

                {/* Name */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    className={inputCls()}
                    value={profileForm.name}
                    onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Ramon Dela Cruz"
                    disabled={saving}
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                    Email Address
                  </label>
                  <input
                    type="email"
                    className={inputCls()}
                    value={profileForm.email}
                    onChange={e => setProfileForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="yourname@ddnppo.gov.ph"
                    disabled={saving}
                  />
                </div>

                {/* Role (read-only) */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                    Role
                  </label>
                  <div className="w-full px-3 py-2.5 border-[1.5px] border-slate-100 rounded-xl text-sm bg-slate-50 text-slate-400 capitalize">
                    {profileForm.role} <span className="text-[10px]">(cannot be changed here)</span>
                  </div>
                </div>

                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
                  ) : '💾 Save Changes'}
                </button>
              </>
            )}

            {tab === 'password' && (
              <>
                <div className="flex items-start gap-2.5 px-3 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                  <span className="flex-shrink-0 mt-0.5">⚠️</span>
                  <span>Use a strong password with at least 6 characters. You will remain logged in after changing.</span>
                </div>

                {/* Current Password */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                    Current Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswords.current ? 'text' : 'password'}
                      className={`${inputCls('current')} pr-10`}
                      placeholder="Enter current password"
                      value={passwordForm.current}
                      onChange={e => {
                        setPasswordForm(f => ({ ...f, current: e.target.value }))
                        setPasswordErrors(p => ({ ...p, current: '' }))
                      }}
                      disabled={saving}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswords(s => ({ ...s, current: !s.current }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                    >
                      {showPasswords.current ? '🙈' : '👁'}
                    </button>
                  </div>
                  {passwordErrors.current && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {passwordErrors.current}</p>}
                </div>

                {/* New Password */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                    New Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswords.next ? 'text' : 'password'}
                      className={`${inputCls('next')} pr-10`}
                      placeholder="Min. 6 characters"
                      value={passwordForm.next}
                      onChange={e => {
                        setPasswordForm(f => ({ ...f, next: e.target.value }))
                        setPasswordErrors(p => ({ ...p, next: '' }))
                      }}
                      disabled={saving}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswords(s => ({ ...s, next: !s.next }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                    >
                      {showPasswords.next ? '🙈' : '👁'}
                    </button>
                  </div>
                  {passwordErrors.next && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {passwordErrors.next}</p>}
                  {/* Strength indicator */}
                  {passwordForm.next && (
                    <div className="mt-1.5 flex gap-1">
                      {[1, 2, 3, 4].map(i => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            passwordForm.next.length >= i * 3
                              ? i <= 1 ? 'bg-red-400'
                                : i <= 2 ? 'bg-amber-400'
                                : i <= 3 ? 'bg-blue-400'
                                : 'bg-emerald-500'
                              : 'bg-slate-200'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                    Confirm Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswords.confirm ? 'text' : 'password'}
                      className={`${inputCls('confirm')} pr-10`}
                      placeholder="Repeat new password"
                      value={passwordForm.confirm}
                      onChange={e => {
                        setPasswordForm(f => ({ ...f, confirm: e.target.value }))
                        setPasswordErrors(p => ({ ...p, confirm: '' }))
                      }}
                      disabled={saving}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswords(s => ({ ...s, confirm: !s.confirm }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                    >
                      {showPasswords.confirm ? '🙈' : '👁'}
                    </button>
                  </div>
                  {passwordErrors.confirm && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {passwordErrors.confirm}</p>}
                  {passwordForm.confirm && passwordForm.next === passwordForm.confirm && (
                    <p className="text-xs text-emerald-600 mt-1 font-medium">✅ Passwords match</p>
                  )}
                </div>

                <button
                  onClick={handleChangePassword}
                  disabled={saving}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Updating…</>
                  ) : '🔑 Update Password'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}