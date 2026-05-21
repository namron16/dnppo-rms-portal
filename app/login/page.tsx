'use client'

import { useState, useCallback, Suspense } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { getDefaultAdminRoute, type SessionRole } from '@/lib/adminRouteAccess'

// ── Role map (labels only — no emails) ───────────────────────────────────────
// Emails are resolved server-side via the get_email_by_role() Supabase RPC.
// This map exists purely for display labels in the <select>.

const ROLE_IDS = [
  'admin', 'PD', 'DPDA', 'DPDO',
  'P1', 'P2', 'P3', 'P4', 'P5',
  'P6', 'P7', 'P8', 'P9', 'P10',
] as const

// The email map is kept here only for the loginPassword call (sign-in with
// password still needs the email on the client side, which is acceptable —
// see auth.tsx comments). If you later want to move this server-side too,
// add a second RPC and call it here before loginPassword.
const ROLE_EMAIL_MAP: Record<string, string> = {
  admin: 'dalenamron@gmail.com',
  PD:    'pd@dnppo.gov.ph',
  DPDA:  '11dnpporms.dpda@gmail.com',
  DPDO:  'dpdo@dnppo.gov.ph',
  P1:    '11dnpporms.p1@gmail.com',
  P2:    '11dnpporms.p2@gmail.com',
  P3:    '11dnpporms.p3@gmail.com',
  P4:    '11dnpporms.p4@gmail.com',
  P5:    '11dnpporms.p5@gmail.com',
  P6:    '11dnpporms.p6@gmail.com',
  P7:    '11dnpporms.p7@gmail.com',
  P8:    '11dnpporms.p8@gmail.com',
  P9:    '11dnpporms.p9@gmail.com',
  P10:   '11dnpporms.p10@gmail.com',
}

function getRoleLabel(id: string): string {
  switch (id) {
    case 'admin': return 'admin — Super Administrator'
    case 'PD':    return 'PD — Provincial Director'
    case 'DPDA':  return 'DPDA — Deputy Director for Administration'
    case 'DPDO':  return 'DPDO — Deputy Director for Operations'
    case 'P1':    return 'P1 — Records Officer'
    default:      return `${id} — Admin Officer ${id}`
  }
}

const ROLE_OPTIONS = ROLE_IDS.map(id => ({ id, label: getRoleLabel(id) }))

// ── Password strength helper ──────────────────────────────────────────────────

function getPwStrength(pw: string): number {
  if (!pw)           return 0
  if (pw.length >= 20) return 4
  if (pw.length >= 16) return 3
  if (pw.length >= 12) return 2
  return 1
}

const PW_STRENGTH_COLORS = ['', 'bg-red-400', 'bg-amber-400', 'bg-blue-500', 'bg-emerald-500']
const PW_STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong']
const PW_STRENGTH_TEXT   = ['', 'text-red-400', 'text-amber-400', 'text-blue-400', 'text-emerald-400']

// ── Shared input class helper ─────────────────────────────────────────────────

function inputCls(hasError = false): string {
  return (
    'w-full px-4 py-3 border rounded-lg text-sm text-slate-800 bg-white ' +
    'focus:outline-none focus:ring-2 transition ' +
    (hasError
      ? 'border-red-300 focus:ring-red-200'
      : 'border-slate-300 focus:ring-[#1b365d]/40')
  )
}

// ── Step progress dots ────────────────────────────────────────────────────────

function StepDots({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {([1, 2, 3] as const).map(n => (
        <div
          key={n}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            n === step
              ? 'w-6 bg-[#fde047]'
              : n < step
              ? 'w-3 bg-[#fde047]/40'
              : 'w-3 bg-slate-200'
          }`}
        />
      ))}
    </div>
  )
}

// ── Inline spinner ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="w-4 h-4 border-2 border-[#fde047] border-t-transparent rounded-full animate-spin flex-shrink-0" />
  )
}

// ── View type ─────────────────────────────────────────────────────────────────

type View = 'login' | 'forgot_role' | 'forgot_otp' | 'forgot_newpw'

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN FORM
// ─────────────────────────────────────────────────────────────────────────────

function LoginForm() {
  const { loginPassword, sendPasswordResetOTP, verifyOTPAndReset } = useAuth()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const reason       = searchParams.get('reason')

  // ── Shared state ──────────────────────────────────────────────────────────
  const [view,    setView]    = useState<View>('login')
  const [loading, setLoading] = useState(false)

  // ── Login fields ──────────────────────────────────────────────────────────
  const [roleId,       setRoleId]       = useState('')
  const [password,     setPassword]     = useState('')
  const [loginError,   setLoginError]   = useState('')
  const [resetSuccess, setResetSuccess] = useState(false)

  // ── Forgot password state ─────────────────────────────────────────────────
  const [fpRoleId,     setFpRoleId]     = useState('')
  const [fpMaskedEmail, setFpMaskedEmail] = useState('') // e.g. "p***@dnppo.gov.ph"
  const [otpCode,      setOtpCode]      = useState('')
  const [fpError,      setFpError]      = useState('')

  // ── Step 3 password fields ────────────────────────────────────────────────
  const [newPw,     setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConPw, setShowConPw] = useState(false)

  const pwStrength = getPwStrength(newPw)

  // ── Reset forgot-password state and return to login ───────────────────────

  function goToLogin() {
    setView('login')
    setFpRoleId('')
    setFpMaskedEmail('')
    setOtpCode('')
    setNewPw('')
    setConfirmPw('')
    setFpError('')
    setLoading(false)
  }

  // ── LOGIN SUBMIT ──────────────────────────────────────────────────────────

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    setResetSuccess(false)

    if (!roleId)   { setLoginError('Please select your role.'); return }
    if (!password) { setLoginError('Please enter your password.'); return }

    setLoading(true)
    const { error } = await loginPassword(ROLE_EMAIL_MAP[roleId] ?? '', password)
    setLoading(false)

    if (error) {
      setLoginError('Invalid credentials. Please check your role and password.')
      return
    }

    router.replace(getDefaultAdminRoute(roleId as SessionRole))
  }, [roleId, password, loginPassword, router])

  // ── STEP 1: send OTP ──────────────────────────────────────────────────────
  // Passes the role to auth — email is resolved server-side via DB RPC.
  // The returned maskedEmail is the only email data the UI ever sees.

  const handleSendOTP = useCallback(async () => {
    setFpError('')
    if (!fpRoleId) { setFpError('Please select your role first.'); return }

    setLoading(true)
    const { maskedEmail, error } = await sendPasswordResetOTP(fpRoleId)
    setLoading(false)

    if (error) { setFpError(error); return }

    setFpMaskedEmail(maskedEmail ?? '')
    setView('forgot_otp')
  }, [fpRoleId, sendPasswordResetOTP])

  // ── STEP 2: validate OTP format, advance wizard ───────────────────────────
  // Actual OTP verification happens together with the password update in step 3
  // (Supabase verifyOtp must be followed immediately by updateUser in the same
  // session — splitting them across steps would require storing a session token).

  const handleVerifyOTP = useCallback(() => {
    setFpError('')
    const trimmed = otpCode.trim()

    if (!trimmed) {
      setFpError('Please enter the 6-digit code.')
      return
    }
    if (trimmed.length !== 6 || !/^\d+$/.test(trimmed)) {
      setFpError('The code must be exactly 6 digits.')
      return
    }

    setView('forgot_newpw')
  }, [otpCode])

  // ── STEP 3: verify OTP + set new password (single atomic call) ────────────

  const handleResetPassword = useCallback(async () => {
    setFpError('')

    if (!newPw) {
      setFpError('Please enter a new password.')
      return
    }
    if (newPw.length < 12) {
      setFpError('Password must be at least 12 characters.')
      return
    }
    if (!confirmPw) {
      setFpError('Please confirm your new password.')
      return
    }
    if (newPw !== confirmPw) {
      setFpError('Passwords do not match.')
      return
    }

    setLoading(true)
    // Role is passed — auth.tsx resolves the email via DB RPC internally
    const { error } = await verifyOTPAndReset(fpRoleId, otpCode.trim(), newPw)
    setLoading(false)

    if (error) { setFpError(error); return }

    goToLogin()
    setResetSuccess(true)
  }, [fpRoleId, otpCode, newPw, confirmPw, verifyOTPAndReset])

  // ── Shared label class ────────────────────────────────────────────────────

  const labelCls = 'block text-[#1b365d] font-bold text-base mb-2'

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="w-[500px] bg-white px-12 py-10 flex flex-col relative shadow-2xl z-20">
      <div className="flex-1 flex flex-col justify-center items-center w-full">

        {/* ── Disabled account banner ── */}
        {reason === 'account_disabled' && view === 'login' && (
          <div className="w-full mb-4 rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-800">
            Your account has been disabled. Contact your system administrator.
          </div>
        )}

        {/* ── Password reset success banner ── */}
        {resetSuccess && view === 'login' && (
          <div className="w-full mb-4 rounded-lg bg-emerald-50 border border-emerald-300 px-4 py-3 text-sm text-emerald-800 flex items-start gap-2">
            <span className="flex-shrink-0">✅</span>
            <span>Password reset successfully. You can now sign in with your new password.</span>
          </div>
        )}

        {/* ══════════════════════════════════════════════
            VIEW: LOGIN
        ══════════════════════════════════════════════ */}
        {view === 'login' && (
          <>
            <div className="text-center mb-10 w-full">
              <h2 className="font-serif text-[2.5rem] text-[#1b365d] font-bold mb-2 flex items-center justify-center gap-3">
                <span className="text-[#fde047] text-2xl">⭐</span>
                Sign In
                <span className="text-[#fde047] text-2xl">⭐</span>
              </h2>
              <p className="text-slate-800 text-sm font-medium">
                Access restricted to authorized DNPPO personnel
              </p>
            </div>

            {loginError && (
              <div className="w-full bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg text-center mb-4">
                {loginError}
              </div>
            )}

            <form onSubmit={handleLogin} noValidate className="w-full space-y-6">
              <div>
                <label className={labelCls}>Role</label>
                <select
                  value={roleId}
                  onChange={e => { setRoleId(e.target.value); setLoginError(''); setResetSuccess(false) }}
                  className={inputCls(!!loginError)}
                  disabled={loading}
                >
                  <option value="" disabled>Select your admin role</option>
                  {ROLE_OPTIONS.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={labelCls} style={{ marginBottom: 0 }}>Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setFpRoleId(roleId) // pre-fill if user already picked a role
                      setFpError('')
                      setView('forgot_role')
                    }}
                    className="text-xs text-[#1b365d]/60 hover:text-[#1b365d] underline underline-offset-2 transition font-medium"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setLoginError(''); setResetSuccess(false) }}
                  placeholder="Enter your password"
                  className={inputCls(!!loginError)}
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !roleId || !password}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold
                           py-3.5 rounded-lg transition text-lg disabled:opacity-70 shadow-md"
              >
                {loading ? 'Signing in…' : 'SIGN IN'}
              </button>
            </form>

            <div className="text-center mt-8 text-[11px] text-slate-400 leading-relaxed font-medium">
              <p>Access credentials are issued by your system administrator</p>
              <p>No public registration available.</p>
            </div>
          </>
        )}

        {/* ══════════════════════════════════════════════
            VIEW: FORGOT — STEP 1 (select role)
        ══════════════════════════════════════════════ */}
        {view === 'forgot_role' && (
          <div className="w-full">

            <button
              onClick={goToLogin}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#1b365d] transition font-medium mb-6"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back to Sign In
            </button>

            <StepDots step={1} />

            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-[#1b365d] flex items-center justify-center mx-auto mb-4 shadow-lg">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fde047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h2 className="font-serif text-2xl text-[#1b365d] font-bold mb-1">Reset Password</h2>
              <p className="text-slate-500 text-sm">
                Select your role and we'll send a 6-digit verification code to your registered email address.
              </p>
            </div>

            {fpError && (
              <div className="w-full bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
                {fpError}
              </div>
            )}

            <div className="space-y-5">
              <div>
                <label className={labelCls}>Your Role</label>
                <select
                  value={fpRoleId}
                  onChange={e => { setFpRoleId(e.target.value); setFpError('') }}
                  className={inputCls(!!fpError && !fpRoleId)}
                  disabled={loading}
                >
                  <option value="" disabled>Select your admin role</option>
                  {ROLE_OPTIONS.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                {/* No email hint shown here — it will appear on the next step
                    as a masked address after the server resolves it */}
              </div>

              <button
                type="button"
                onClick={handleSendOTP}
                disabled={loading || !fpRoleId}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold
                           py-3.5 rounded-lg transition text-base disabled:opacity-70 shadow-md
                           flex items-center justify-center gap-2"
              >
                {loading ? <><Spinner /> Sending code…</> : 'Send Verification Code'}
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════
            VIEW: FORGOT — STEP 2 (enter OTP)
        ══════════════════════════════════════════════ */}
        {view === 'forgot_otp' && (
          <div className="w-full">

            <button
              onClick={() => { setView('forgot_role'); setFpError('') }}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#1b365d] transition font-medium mb-6"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>

            <StepDots step={2} />

            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-[#1b365d] flex items-center justify-center mx-auto mb-4 shadow-lg">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fde047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <h2 className="font-serif text-2xl text-[#1b365d] font-bold mb-1">Check Your Email</h2>
              <p className="text-slate-500 text-sm">A 6-digit code was sent to</p>
              {/* Only the masked address is shown — never the raw email */}
              {fpMaskedEmail && (
                <p className="text-[#1b365d] font-semibold text-sm mt-0.5">{fpMaskedEmail}</p>
              )}
            </div>

            {fpError && (
              <div className="w-full bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
                {fpError}
              </div>
            )}

            <div className="space-y-5">
              <div>
                <label className={labelCls}>Verification Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={e => {
                    setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                    setFpError('')
                  }}
                  placeholder="Enter 6-digit code"
                  className={`${inputCls(!!fpError)} text-center text-xl tracking-[0.5em] font-bold font-mono`}
                  disabled={loading}
                  autoComplete="one-time-code"
                />
                <p className="text-[11px] text-slate-400 mt-1.5 text-center">
                  Didn't receive it?{' '}
                  <button
                    type="button"
                    onClick={() => { setOtpCode(''); setFpError(''); handleSendOTP() }}
                    className="text-[#1b365d] underline underline-offset-2 hover:opacity-70 transition font-semibold"
                    disabled={loading}
                  >
                    Resend code
                  </button>
                </p>
              </div>

              <button
                type="button"
                onClick={handleVerifyOTP}
                disabled={loading || otpCode.length !== 6}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold
                           py-3.5 rounded-lg transition text-base disabled:opacity-70 shadow-md
                           flex items-center justify-center gap-2"
              >
                {loading ? <><Spinner /> Verifying…</> : 'Verify Code'}
              </button>
            </div>

            <div className="mt-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-[11px] text-amber-800 text-center">
                ⏱ The code expires in <strong>1 hour</strong>. Check spam/junk if not received.
              </p>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════
            VIEW: FORGOT — STEP 3 (set new password)
        ══════════════════════════════════════════════ */}
        {view === 'forgot_newpw' && (
          <div className="w-full">

            <button
              onClick={() => { setView('forgot_otp'); setFpError('') }}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#1b365d] transition font-medium mb-6"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>

            <StepDots step={3} />

            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-[#1b365d] flex items-center justify-center mx-auto mb-4 shadow-lg">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fde047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h2 className="font-serif text-2xl text-[#1b365d] font-bold mb-1">Set New Password</h2>
              <p className="text-slate-500 text-sm">
                Choose a strong password — minimum 12 characters.
              </p>
            </div>

            {fpError && (
              <div className="w-full bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">
                {fpError}
              </div>
            )}

            <div className="space-y-4">

              {/* New password */}
              <div>
                <label className={labelCls}>New Password</label>
                <div className="relative">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    value={newPw}
                    onChange={e => { setNewPw(e.target.value); setFpError('') }}
                    placeholder="Min. 12 characters"
                    className={`${inputCls(!!fpError && !newPw)} pr-10`}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    {showNewPw ? '🙈' : '👁'}
                  </button>
                </div>
                {newPw && (
                  <div className="mt-2 space-y-1">
                    <div className="flex gap-1">
                      {[1,2,3,4].map(i => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            pwStrength >= i ? PW_STRENGTH_COLORS[pwStrength] : 'bg-slate-200'
                          }`}
                        />
                      ))}
                    </div>
                    <p className={`text-[10px] font-semibold ${PW_STRENGTH_TEXT[pwStrength]}`}>
                      {PW_STRENGTH_LABELS[pwStrength]}
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <label className={labelCls}>Confirm Password</label>
                <div className="relative">
                  <input
                    type={showConPw ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={e => { setConfirmPw(e.target.value); setFpError('') }}
                    placeholder="Repeat new password"
                    className={`${inputCls(!!fpError && !confirmPw)} pr-10`}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    {showConPw ? '🙈' : '👁'}
                  </button>
                </div>
                {confirmPw && newPw === confirmPw && (
                  <p className="text-xs text-emerald-600 mt-1 font-medium">✅ Passwords match</p>
                )}
              </div>

              <button
                type="button"
                onClick={handleResetPassword}
                disabled={loading || newPw.length < 12 || newPw !== confirmPw}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold
                           py-3.5 rounded-lg transition text-base disabled:opacity-70 shadow-md
                           flex items-center justify-center gap-2 mt-2"
              >
                {loading ? <><Spinner /> Resetting password…</> : '🔑 Reset Password'}
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ── STI Footer ── */}
      <div className="mt-auto pt-6 flex items-center justify-center gap-3 w-full border-t border-slate-100">
        <p className="text-[10px] text-slate-700 font-medium leading-tight text-center max-w-[250px]">
          This Record Management System was developed in collaboration with the 4th-year BSIS students, Class 2026 of STI College Tagum.
        </p>
        <Image
          src="/assets/sti-tagum-logo.png"
          alt="STI Logo"
          width={35}
          height={35}
          sizes="35px"
          className="h-auto w-auto object-contain"
        />
      </div>

      <p className="text-[10px] text-slate-700/20 font-medium text-center my-5 translate-y-12">
        Steven Prudente
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE SHELL
// ─────────────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  return (
    <div className="min-h-screen flex font-sans">

      {/* Left: Branding panel */}
      <div
        className="flex-1 relative overflow-hidden flex flex-col justify-center px-16"
        style={{ backgroundColor: '#2e4769' }}
      >
        <Image src="/assets/pnp-bg.jpg" alt="" fill priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover object-center" />
        <div className="absolute inset-0 bg-[#2e4769]/75 mix-blend-overlay" />

        <div className="inline-flex w-fit mb-6 items-center gap-3 border-[3px] border-[#fde047] rounded-full pl-2 pr-6 py-1.5 bg-[#1b365d]/80 backdrop-blur-sm shadow-xl">
          <Image src="/assets/dnppo-logo.png" alt="DNPPO Logo" width={48} height={48}
            priority sizes="48px" className="w-12 h-12 rounded-full bg-white object-contain" />
          <span className="text-[#fde047] font-serif text-lg leading-tight font-medium tracking-wide">
            Davao Norte Police Provincial Office
          </span>
        </div>

        <div className="relative z-10 max-w-2xl" style={{ textShadow: '5px 2px 5px rgba(0,0,0,0.8)' }}>
          <h1 className="font-serif text-[4rem] text-[#fde047] leading-[1.1] mb-6 drop-shadow-lg font-bold">
            Records Management<br />System
          </h1>
          <p className="text-[#fde047] text-lg leading-snug max-w-lg drop-shadow-md font-medium">
            Secure, centralized document management for Davao Norte Provincial Police Office personnel
          </p>
        </div>

        <div className="absolute top-10 right-10 pointer-events-none">
          <Image src="/assets/pnp-logo.png" alt="PNP Background" width={250} height={250}
            sizes="300px" className="w-[150px] h-auto drop-shadow-2xl" />
        </div>
      </div>

      {/* Right: Login / Reset wizard */}
      <Suspense fallback={
        <div className="w-[500px] bg-white flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#1b365d] border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <LoginForm />
      </Suspense>

    </div>
  )
}