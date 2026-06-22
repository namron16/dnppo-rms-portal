'use client'

import { useState, useCallback, useRef, Suspense, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { getDefaultAdminRoute, type SessionRole } from '@/lib/adminRouteAccess'
import { createClient } from '@/lib/supabase/client'

// ── Password strength helper ──────────────────────────────────────────────────

function getPwStrength(pw: string): number {
  if (!pw)             return 0
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
    'w-full px-3 py-2 border rounded-lg text-sm text-slate-800 bg-white ' +
    'focus:outline-none focus:ring-2 transition ' +
    (hasError
      ? 'border-red-300 focus:ring-red-200'
      : 'border-slate-300 focus:ring-[#1b365d]/40')
  )
}

// ── Step progress dots ────────────────────────────────────────────────────────

function StepDots({ step, total = 3 }: { step: number; total?: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-4">
      {Array.from({ length: total }, (_, i) => i + 1).map(n => (
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

// Login flow:   login_otp_request → login_otp_verify → login_password → dashboard
// Forgot flow:  forgot_role → forgot_otp → forgot_newpw
type View =
  | 'login_otp_request'
  | 'login_otp_verify'
  | 'login_password'
  | 'forgot_role'
  | 'forgot_otp'
  | 'forgot_newpw'

// ── Feature list for branding panel ──────────────────────────────────────────

const FEATURES = [
  {
    icon: '👤',
    title: 'Personnel Directory',
    desc: 'Centralized profiles of all DNPPO personnel.',
  },
  {
    icon: '🗂️',
    title: 'Records Management',
    desc: 'Organize, store, and retrieve official documents.',
  },
  {
    icon: '📤',
    title: 'Document Sharing',
    desc: 'Securely share files between authorized offices.',
  },
  {
    icon: '📍',
    title: 'Document Tracking',
    desc: 'Monitor document flow and approval status in real time.',
  },
  {
    icon: '🗄️',
    title: 'Virtual Repository',
    desc: 'Digitized archives accessible anytime, anywhere.',
  },
  {
    icon: '📚',
    title: 'Information Library',
    desc: 'Reference materials and policies in one place.',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN FORM
// ─────────────────────────────────────────────────────────────────────────────

function LoginForm() {
  const [roleOptions, setRoleOptions] = useState<{ id: string; label: string }[]>([])

  const { loginPassword, sendPasswordResetOTP, verifyOTPAndReset } = useAuth()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const reason       = searchParams.get('reason')

  const [view,    setView]    = useState<View>('login_otp_request')
  const [loading, setLoading] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)

  // ── 2FA login state ───────────────────────────────────────────────────────
  // roleId + maskedEmail are set in step 1 and carried through all login steps.
  // otpCode is entered in step 2 and held until step 3 verifies it after password.
  // pendingEmail holds the resolved plain email (needed for verifyOtp) — stored
  // in a ref so it never triggers re-renders and isn't accessible in the DOM.
  const [roleId,       setRoleId]       = useState('')
  const [maskedEmail,  setMaskedEmail]  = useState('')
  const [otpCode,      setOtpCode]      = useState('')
  const [password,     setPassword]     = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loginError,   setLoginError]   = useState('')
  const pendingEmailRef = useRef<string>('')

  // ── Forgot password state ─────────────────────────────────────────────────
  const [fpRoleId,      setFpRoleId]      = useState('')
  const [fpMaskedEmail, setFpMaskedEmail] = useState('')
  const [fpOtpCode,     setFpOtpCode]     = useState('')
  const [fpError,       setFpError]       = useState('')
  const [newPw,         setNewPw]         = useState('')
  const [confirmPw,     setConfirmPw]     = useState('')
  const [showNewPw,     setShowNewPw]     = useState(false)
  const [showConPw,     setShowConPw]     = useState(false)

  const pwStrength = getPwStrength(newPw)

  // ── Load active roles ─────────────────────────────────────────────────────

  useEffect(() => {
    async function loadRoles() {
      const supabase = createClient()
      const { data } = await supabase.rpc('get_active_roles')
      if (data) {
        setRoleOptions(
          (data as { role: string; display_name: string }[]).map(r => ({
            id:    r.role,
            label: `${r.role} — ${r.display_name}`,
          }))
        )
      }
    }
    void loadRoles()
  }, [])

  // ── Helpers ───────────────────────────────────────────────────────────────

  function resetLoginFlow() {
    setView('login_otp_request')
    setRoleId('')
    setMaskedEmail('')
    setOtpCode('')
    setPassword('')
    setShowPassword(false)
    setLoginError('')
    setLoading(false)
    pendingEmailRef.current = ''
  }

  function goToForgotLogin() {
    setView('forgot_role')
    setFpRoleId('')
    setFpMaskedEmail('')
    setFpOtpCode('')
    setNewPw('')
    setConfirmPw('')
    setFpError('')
    setLoading(false)
  }

  const labelCls = 'block text-[#1b365d] font-semibold text-sm mb-1'

  const backBtn = (onClick: () => void, label = 'Back') => (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#1b365d] transition font-medium mb-4"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      {label}
    </button>
  )

  const errorBox = (msg: string) => (
    <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs leading-snug mb-3">
      <span className="flex-shrink-0">❌</span><span>{msg}</span>
    </div>
  )

  // ── STEP 1: Select role + send OTP ────────────────────────────────────────

  const handleSendLoginOTP = useCallback(async () => {
    setLoginError('')
    if (!roleId) { setLoginError('Please select your role first.'); return }
    setLoading(true)
    const { maskedEmail: masked, error } = await sendPasswordResetOTP(roleId)
    setLoading(false)
    if (error) { setLoginError(error); return }
    // Store masked email for display; the plain email is resolved inside
    // sendPasswordResetOTP → we'll re-resolve it during verifyOtp in step 3.
    setMaskedEmail(masked ?? '')
    setView('login_otp_verify')
  }, [roleId, sendPasswordResetOTP])

  // ── STEP 2: Verify OTP format, advance to password ────────────────────────
  // We don't call verifyOtp here — we hold the code and verify it AFTER the
  // password check succeeds (step 3), so both factors are confirmed together.

  const handleOTPNext = useCallback(() => {
    setLoginError('')
    const trimmed = otpCode.trim()
    if (!trimmed)                                    { setLoginError('Please enter the 6-digit code.'); return }
    if (trimmed.length !== 6 || !/^\d+$/.test(trimmed)) { setLoginError('The code must be exactly 6 digits.'); return }
    setView('login_password')
  }, [otpCode])

  // ── STEP 3: Verify password then OTP, commit session ─────────────────────

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    if (!password) { setLoginError('Please enter your password.'); return }

    setLoading(true)

    // 3a. Verify password — loginPassword signs in via Supabase and sets
    //     the user in AuthContext only if both checks pass (see step 3b).
    //     We temporarily intercept by checking error first.
    const { error: pwError } = await loginPassword(roleId, password)
    if (pwError) {
      setLoading(false)
      setLoginError(
        pwError.toLowerCase().includes('disabled')
          ? pwError
          : 'Invalid credentials. Please check your password.'
      )
      return
    }

    // 3b. Verify OTP — now that password is confirmed, verify the code the
    //     user entered in step 2. We use verifyOTPAndReset's internal path
    //     but we need direct supabase access here for type:'email' verify.
    //     Re-resolve email from role via the same RPC used by auth.tsx.
    const supabase = createClient()
    const { data: emailData } = await supabase.rpc('get_email_by_role', { p_role: roleId })
    const resolvedEmail = emailData as string | null

    if (!resolvedEmail) {
      setLoading(false)
      setLoginError('Could not verify identity. Please restart the sign-in.')
      return
    }

    const { error: otpError } = await supabase.auth.verifyOtp({
      email: resolvedEmail,
      token: otpCode.trim(),
      type:  'email',
    })

    setLoading(false)

    if (otpError) {
      // OTP failed — sign out the password session so the user isn't
      // partially authenticated, then send them back to re-enter the code.
      await supabase.auth.signOut({ scope: 'local' })
      setOtpCode('')
      setView('login_otp_verify')
      setLoginError('Incorrect or expired code. A new code has been sent — please check your email.')
      // Re-send a fresh code so they're not stuck with an expired one
      void sendPasswordResetOTP(roleId)
      return
    }

    // Both factors passed — loginPassword already committed the session to
    // AuthContext, so we can redirect now.
    router.replace(getDefaultAdminRoute(roleId as SessionRole))
  }, [roleId, password, otpCode, loginPassword, sendPasswordResetOTP, router])

  // ── Forgot password handlers (unchanged logic) ────────────────────────────

  const handleFpSendOTP = useCallback(async () => {
    setFpError('')
    if (!fpRoleId) { setFpError('Please select your role first.'); return }
    setLoading(true)
    const { maskedEmail: masked, error } = await sendPasswordResetOTP(fpRoleId)
    setLoading(false)
    if (error) { setFpError(error); return }
    setFpMaskedEmail(masked ?? '')
    setView('forgot_otp')
  }, [fpRoleId, sendPasswordResetOTP])

  const handleFpVerifyOTP = useCallback(() => {
    setFpError('')
    const trimmed = fpOtpCode.trim()
    if (!trimmed)                                        { setFpError('Please enter the 6-digit code.'); return }
    if (trimmed.length !== 6 || !/^\d+$/.test(trimmed)) { setFpError('The code must be exactly 6 digits.'); return }
    setView('forgot_newpw')
  }, [fpOtpCode])

  const handleResetPassword = useCallback(async () => {
    setFpError('')
    if (!newPw)              { setFpError('Please enter a new password.'); return }
    if (newPw.length < 12)   { setFpError('Password must be at least 12 characters.'); return }
    if (!confirmPw)          { setFpError('Please confirm your new password.'); return }
    if (newPw !== confirmPw) { setFpError('Passwords do not match.'); return }
    setLoading(true)
    const { error } = await verifyOTPAndReset(fpRoleId, fpOtpCode.trim(), newPw)
    setLoading(false)
    if (error) { setFpError(error); return }
    resetLoginFlow()
    setResetSuccess(true)
  }, [fpRoleId, fpOtpCode, newPw, confirmPw, verifyOTPAndReset])

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="w-[460px] flex-shrink-0 bg-white flex flex-col h-screen overflow-y-auto shadow-2xl z-20">
      <div className="flex-1 flex flex-col justify-center px-10 py-6">

        {/* ══ STEP 1 — Select Role + Send OTP ══ */}
        {view === 'login_otp_request' && (
          <>
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-2xl bg-[#1b365d] flex items-center justify-center mx-auto mb-3 shadow-lg">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fde047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <StepDots step={1} total={3} />
              <h2 className="font-serif text-[2rem] text-[#1b365d] font-bold mb-1 flex items-center justify-center gap-2">
                <span className="text-[#fde047] text-xl">⭐</span>
                Sign In
                <span className="text-[#fde047] text-xl">⭐</span>
              </h2>
              <p className="text-slate-500 text-xs font-medium">
                Select your role to receive a verification code
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelCls}>Role</label>
                <select
                  value={roleId}
                  onChange={e => { setRoleId(e.target.value); setLoginError('') }}
                  className={inputCls(!!loginError)}
                  disabled={loading}
                  autoComplete="username"
                  name="username"
                >
                  <option value="" disabled>Select your admin role</option>
                  {roleOptions.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>

              {loginError && errorBox(loginError)}

              {resetSuccess && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs leading-snug">
                  <span className="flex-shrink-0">✅</span>
                  <span>Password reset successfully. You can now sign in with your new password.</span>
                </div>
              )}

              {reason === 'account_disabled' && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs leading-snug">
                  <span className="flex-shrink-0">🔒</span>
                  <span>Your account has been disabled. Contact your system administrator.</span>
                </div>
              )}
              {reason === 'session_taken' && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs leading-snug">
                  <span className="flex-shrink-0">⚠️</span>
                  <span>Your session was ended because this account was signed in from another device.</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleSendLoginOTP}
                disabled={loading || !roleId}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold
                           py-3 rounded-lg transition text-base disabled:opacity-70 shadow-md
                           flex items-center justify-center gap-2"
              >
                {loading ? <><Spinner /> Sending code…</> : 'Send Verification Code'}
              </button>
            </div>

            <div className="mt-5 pt-4 border-t border-slate-200">
              <p className="text-center text-[10px] text-slate-600 font-medium mb-2">
                By signing in, you agree to our
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <Link href="/terms-and-condition" target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-[#1b365d] hover:text-[#0f1c35] underline underline-offset-2 font-semibold transition">
                  Terms and Conditions
                </Link>
                <span className="text-[10px] text-slate-400">and</span>
                <Link href="/privacy-policy" target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-[#1b365d] hover:text-[#0f1c35] underline underline-offset-2 font-semibold transition">
                  Privacy Policy
                </Link>
              </div>
            </div>
            <p className="text-center mt-3 text-[10px] text-slate-400 font-medium">
              Credentials are issued by your system administrator. No public registration.
            </p>
          </>
        )}

        {/* ══ STEP 2 — Enter OTP ══ */}
        {view === 'login_otp_verify' && (
          <div>
            {backBtn(resetLoginFlow, 'Back to Sign In')}
            <StepDots step={2} total={3} />
            <div className="text-center mb-5">
              <div className="w-12 h-12 rounded-2xl bg-[#1b365d] flex items-center justify-center mx-auto mb-3 shadow-lg">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fde047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <h2 className="font-serif text-xl text-[#1b365d] font-bold mb-1">Check Your Email</h2>
              <p className="text-slate-500 text-xs">A 6-digit code was sent to</p>
              {maskedEmail && (
                <p className="text-[#1b365d] font-semibold text-sm mt-0.5">{maskedEmail}</p>
              )}
            </div>

            {loginError && errorBox(loginError)}

            <div className="space-y-4">
              <div>
                <label className={labelCls}>Verification Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={e => { setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setLoginError('') }}
                  placeholder="Enter 6-digit code"
                  className={`${inputCls(!!loginError)} text-center text-xl tracking-[0.5em] font-bold font-mono`}
                  disabled={loading}
                  autoComplete="one-time-code"
                />
                <p className="text-[10px] text-slate-400 mt-1.5 text-center">
                  Didn't receive it?{' '}
                  <button
                    type="button"
                    onClick={() => { setOtpCode(''); setLoginError(''); void handleSendLoginOTP() }}
                    className="text-[#1b365d] underline underline-offset-2 hover:opacity-70 transition font-semibold"
                    disabled={loading}
                  >
                    Resend code
                  </button>
                </p>
              </div>

              <button
                type="button"
                onClick={handleOTPNext}
                disabled={loading || otpCode.length !== 6}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold py-3 rounded-lg transition text-sm disabled:opacity-70 shadow-md flex items-center justify-center gap-2"
              >
                {loading ? <><Spinner /> Verifying…</> : 'Continue'}
              </button>
            </div>

            <div className="mt-4 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-[10px] text-amber-800 text-center">
                ⏱ The code expires in <strong>10 mins</strong>. Check spam/junk if not received.
              </p>
            </div>
          </div>
        )}

        {/* ══ STEP 3 — Enter Password ══ */}
        {view === 'login_password' && (
          <div>
            {backBtn(() => { setView('login_otp_verify'); setLoginError('') }, 'Back')}
            <StepDots step={3} total={3} />
            <div className="text-center mb-5">
              <div className="w-12 h-12 rounded-2xl bg-[#1b365d] flex items-center justify-center mx-auto mb-3 shadow-lg">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fde047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h2 className="font-serif text-xl text-[#1b365d] font-bold mb-1">Enter Password</h2>
              <p className="text-slate-500 text-xs">
                Signing in as <span className="font-semibold text-[#1b365d]">{roleId}</span>
              </p>
            </div>

            {loginError && errorBox(loginError)}

            <form onSubmit={handleLogin} noValidate className="space-y-4">
              {/* Hidden username field for password manager association */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={roleId}
                readOnly
                aria-hidden="true"
                tabIndex={-1}
                style={{ display: 'none' }}
              />
              <div>
                <label className={labelCls}>Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setLoginError('') }}
                    placeholder="Enter your password"
                    className={`${inputCls(!!loginError)} pr-10`}
                    disabled={loading}
                    autoComplete="current-password"
                    name="password"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    {showPassword ? '🙈' : '👁'}
                  </button>
                </div>
                <div className="text-right mt-1">
                  <button
                    type="button"
                    onClick={() => { setFpRoleId(roleId); setFpError(''); goToForgotLogin() }}
                    className="text-xs text-[#1b365d]/60 hover:text-[#1b365d] underline underline-offset-2 transition font-medium"
                  >
                    Forgot password?
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !password}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold
                           py-3 rounded-lg transition text-base disabled:opacity-70 shadow-md
                           flex items-center justify-center gap-2"
              >
                {loading ? <><Spinner /> Signing in…</> : 'SIGN IN'}
              </button>
            </form>
          </div>
        )}

        {/* ══ FORGOT — STEP 1 ══ */}
        {view === 'forgot_role' && (
          <div>
            {backBtn(resetLoginFlow, 'Back to Sign In')}
            <StepDots step={1} total={3} />
            <div className="text-center mb-5">
              <div className="w-12 h-12 rounded-2xl bg-[#1b365d] flex items-center justify-center mx-auto mb-3 shadow-lg">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fde047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <h2 className="font-serif text-xl text-[#1b365d] font-bold mb-1">Reset Password</h2>
              <p className="text-slate-500 text-xs">Select your role and we'll send a 6-digit code to your registered email.</p>
            </div>
            {fpError && errorBox(fpError)}
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Your Role</label>
                <select value={fpRoleId} onChange={e => { setFpRoleId(e.target.value); setFpError('') }}
                  className={inputCls(!!fpError && !fpRoleId)} disabled={loading}>
                  <option value="" disabled>Select your admin role</option>
                  {roleOptions.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
              <button type="button" onClick={handleFpSendOTP} disabled={loading || !fpRoleId}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold py-3 rounded-lg transition text-sm disabled:opacity-70 shadow-md flex items-center justify-center gap-2">
                {loading ? <><Spinner /> Sending code…</> : 'Send Verification Code'}
              </button>
            </div>
          </div>
        )}

        {/* ══ FORGOT — STEP 2 ══ */}
        {view === 'forgot_otp' && (
          <div>
            {backBtn(() => { setView('forgot_role'); setFpError('') }, 'Back')}
            <StepDots step={2} total={3} />
            <div className="text-center mb-5">
              <div className="w-12 h-12 rounded-2xl bg-[#1b365d] flex items-center justify-center mx-auto mb-3 shadow-lg">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fde047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <h2 className="font-serif text-xl text-[#1b365d] font-bold mb-1">Check Your Email</h2>
              <p className="text-slate-500 text-xs">A 6-digit code was sent to</p>
              {fpMaskedEmail && <p className="text-[#1b365d] font-semibold text-sm mt-0.5">{fpMaskedEmail}</p>}
            </div>
            {fpError && errorBox(fpError)}
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Verification Code</label>
                <input type="text" inputMode="numeric" maxLength={6} value={fpOtpCode}
                  onChange={e => { setFpOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setFpError('') }}
                  placeholder="Enter 6-digit code"
                  className={`${inputCls(!!fpError)} text-center text-xl tracking-[0.5em] font-bold font-mono`}
                  disabled={loading} autoComplete="one-time-code" />
                <p className="text-[10px] text-slate-400 mt-1.5 text-center">
                  Didn't receive it?{' '}
                  <button type="button" onClick={() => { setFpOtpCode(''); setFpError(''); void handleFpSendOTP() }}
                    className="text-[#1b365d] underline underline-offset-2 hover:opacity-70 transition font-semibold" disabled={loading}>
                    Resend code
                  </button>
                </p>
              </div>
              <button type="button" onClick={handleFpVerifyOTP} disabled={loading || fpOtpCode.length !== 6}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold py-3 rounded-lg transition text-sm disabled:opacity-70 shadow-md flex items-center justify-center gap-2">
                {loading ? <><Spinner /> Verifying…</> : 'Verify Code'}
              </button>
            </div>
            <div className="mt-4 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-[10px] text-amber-800 text-center">
                ⏱ The code expires in <strong>10 mins</strong>. Check spam/junk if not received.
              </p>
            </div>
          </div>
        )}

        {/* ══ FORGOT — STEP 3 ══ */}
        {view === 'forgot_newpw' && (
          <div>
            {backBtn(() => { setView('forgot_otp'); setFpError('') }, 'Back')}
            <StepDots step={3} total={3} />
            <div className="text-center mb-5">
              <div className="w-12 h-12 rounded-2xl bg-[#1b365d] flex items-center justify-center mx-auto mb-3 shadow-lg">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fde047" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h2 className="font-serif text-xl text-[#1b365d] font-bold mb-1">Set New Password</h2>
              <p className="text-slate-500 text-xs">Choose a strong password — minimum 12 characters.</p>
            </div>
            {fpError && errorBox(fpError)}
            <div className="space-y-3">
              <div>
                <label className={labelCls}>New Password</label>
                <div className="relative">
                  <input type={showNewPw ? 'text' : 'password'} value={newPw}
                    onChange={e => { setNewPw(e.target.value); setFpError('') }}
                    placeholder="Min. 12 characters"
                    className={`${inputCls(!!fpError && !newPw)} pr-10`}
                    disabled={loading} autoComplete="new-password" />
                  <button type="button" onClick={() => setShowNewPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">
                    {showNewPw ? '🙈' : '👁'}
                  </button>
                </div>
                {newPw && (
                  <div className="mt-1.5 space-y-0.5">
                    <div className="flex gap-1">
                      {[1,2,3,4].map(i => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${pwStrength >= i ? PW_STRENGTH_COLORS[pwStrength] : 'bg-slate-200'}`} />
                      ))}
                    </div>
                    <p className={`text-[10px] font-semibold ${PW_STRENGTH_TEXT[pwStrength]}`}>{PW_STRENGTH_LABELS[pwStrength]}</p>
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Confirm Password</label>
                <div className="relative">
                  <input type={showConPw ? 'text' : 'password'} value={confirmPw}
                    onChange={e => { setConfirmPw(e.target.value); setFpError('') }}
                    placeholder="Repeat new password"
                    className={`${inputCls(!!fpError && !confirmPw)} pr-10`}
                    disabled={loading} autoComplete="new-password" />
                  <button type="button" onClick={() => setShowConPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">
                    {showConPw ? '🙈' : '👁'}
                  </button>
                </div>
                {confirmPw && newPw === confirmPw && (
                  <p className="text-xs text-emerald-600 mt-1 font-medium">✅ Passwords match</p>
                )}
              </div>
              <button type="button" onClick={handleResetPassword} disabled={loading || newPw.length < 12 || newPw !== confirmPw}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold py-3 rounded-lg transition text-sm disabled:opacity-70 shadow-md flex items-center justify-center gap-2 mt-1">
                {loading ? <><Spinner /> Resetting password…</> : '🔑 Reset Password'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── STI Footer ── */}
      <div className="px-10 py-4 border-t border-slate-100 flex items-center justify-center gap-3">
        <p className="text-[9px] text-slate-500 font-medium leading-tight text-center max-w-[220px]">
          Developed in collaboration with 4th-year BSIS students, Class 2026 of STI College Tagum.
        </p>
        <Image
          src="/assets/sti-tagum-logo.png"
          alt="STI College Tagum Logo"
          width={30}
          height={30}
          sizes="30px"
          className="h-auto w-auto object-contain"
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE SHELL
// ─────────────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  return (
    <div className="h-screen overflow-hidden flex font-sans">

      {/* Left: Branding panel */}
      <div
        className="flex-1 relative overflow-hidden flex flex-col justify-between px-12 py-8"
        style={{ backgroundColor: '#2e4769' }}
      >
        <Image
          src="/assets/pnp-bg.jpg"
          alt=""
          fill
          priority
          quality={85}
          sizes="(max-width: 1024px) 100vw, 60vw"
          className="object-cover object-center"
        />

        <div className="absolute inset-0 bg-[#2e4769]/75 mix-blend-overlay" />

        {/* Top: logo badge + PNP watermark */}
        <div className="relative z-10 flex items-start justify-between">
          <div className="inline-flex items-center gap-3 border-[3px] border-[#fde047] rounded-full pl-2 pr-5 py-1.5 bg-[#1b365d]/80 backdrop-blur-sm shadow-xl">
            <Image
              src="/assets/dnppo-logo.png"
              alt="DNPPO Logo"
              width={40}
              height={40}
              priority
              sizes="40px"
              className="w-10 h-10 rounded-full bg-white object-contain"
            />
            <span className="text-[#fde047] font-serif text-base leading-tight font-medium tracking-wide">
              Davao Norte Police Provincial Office
            </span>
          </div>
          <Image
            src="/assets/pnp-logo.png"
            alt="Philippine National Police Logo"
            width={70}
            height={70}
            priority
            sizes="70px"
            className="drop-shadow-2xl opacity-80"
            style={{ width: '70px', height: 'auto' }}
          />
        </div>

        {/* Middle: headline */}
        <div className="relative z-10" style={{ textShadow: '3px 2px 6px rgba(0,0,0,0.7)' }}>
          <h1 className="font-serif text-[3rem] text-[#fde047] leading-[1.1] mb-2 font-bold drop-shadow-lg">
            PORTAL Information<br />System
          </h1>
          <p className="text-[#fde047]/90 text-sm leading-snug max-w-sm font-medium">
            Personnel and Office Records Tracking, Archives, and Library.
          </p>
        </div>

        {/* Bottom: feature grid */}
        <div className="relative z-10">
          <p className="text-[#fde047]/60 text-[10px] uppercase tracking-widest font-semibold mb-3">
            System Features
          </p>
          <div className="grid grid-cols-3 gap-2">
            {FEATURES.map(f => (
              <div
                key={f.title}
                className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-3 py-2.5"
              >
                <p className="text-base mb-0.5">{f.icon}</p>
                <p className="text-[#fde047] text-[11px] font-bold leading-tight">{f.title}</p>
                <p className="text-white/70 text-[10px] leading-snug mt-0.5">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Login / Reset wizard */}
      <Suspense fallback={
        <div className="w-[460px] flex-shrink-0 bg-white flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-[#1b365d] border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <LoginForm />
      </Suspense>

    </div>
  )
}