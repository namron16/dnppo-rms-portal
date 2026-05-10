'use client'
// app/login/page.tsx — Three-step login: Email → OTP → Password
// Design preserved from original. Auth replaced with Supabase OTP flow.

import { useState, useCallback } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { getDefaultAdminRoute, type SessionRole } from '@/lib/adminRouteAccess'

// Role → email map: maps the dropdown selection to the seeded Supabase email.
// Update these to match the exact emails used in your seed script.
const ROLE_EMAIL_MAP: Record<string, string> = {
  admin: 'superadmin@dnppo.gov.ph',
  PD:    'pd@dnppo.gov.ph',
  DPDA:  'dpda@dnppo.gov.ph',
  DPDO:  'dpdo@dnppo.gov.ph',
  P1:    'p1@dnppo.gov.ph',
  P2:    'p2@dnppo.gov.ph',
  P3:    'p3@dnppo.gov.ph',
  P4:    'p4@dnppo.gov.ph',
  P5:    'p5@dnppo.gov.ph',
  P6:    'p6@dnppo.gov.ph',
  P7:    'p7@dnppo.gov.ph',
  P8:    'p8@dnppo.gov.ph',
  P9:    'p9@dnppo.gov.ph',
  P10:   'p10@dnppo.gov.ph',
}

const ROLE_OPTIONS = Object.entries(ROLE_EMAIL_MAP).map(([id]) => ({
  id,
  label: getRoleLabel(id),
}))

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

type Step = 'role' | 'otp' | 'password'

export default function LoginPage() {
  const { sendOtp, verifyOtp, loginPassword } = useAuth()
  const router = useRouter()

  const searchParams = useSearchParams()
  const reason = searchParams.get('reason')
  const [step,     setStep]     = useState<Step>('role')
  const [roleId,   setRoleId]   = useState('')
  const [otp,      setOtp]      = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  // Derived — the email for the selected role
  const selectedEmail = ROLE_EMAIL_MAP[roleId] ?? ''

  // ── Step 1: Role select → Send OTP ───────

  const handleSendOtp = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!roleId) {
      setError('Please select your role.')
      return
    }

    setLoading(true)
    const { error } = await sendOtp(selectedEmail)
    setLoading(false)

    if (error) {
      // Deliberately vague — don't reveal whether the account exists
      setError('Could not send verification code. Please try again or contact your administrator.')
      return
    }

    setStep('otp')
  }, [roleId, selectedEmail, sendOtp])

  // ── Step 2: Verify OTP ────────────────────

  const handleVerifyOtp = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await verifyOtp(selectedEmail, otp.trim())

    setLoading(false)

    if (error) {
      setError('Invalid or expired code. Please try again.')
      return
    }

    setStep('password')
  }, [selectedEmail, otp, verifyOtp])

  // ── Step 3: Password → Login ──────────────

  const handlePassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await loginPassword(selectedEmail, password)

    setLoading(false)

    if (error) {
      setError('Incorrect password. Please try again.')
      return
    }

    router.replace(getDefaultAdminRoute(roleId as SessionRole))
  }, [selectedEmail, password, loginPassword, router, roleId])

  // ── Shared input style ────────────────────

  const inputBaseClass =
    'w-full px-4 py-3 border rounded-lg text-sm text-slate-800 bg-white ' +
    'focus:outline-none focus:ring-2 focus:ring-[#1b365d]/50 transition'

  const inputClass = error
    ? `${inputBaseClass} border-red-300`
    : `${inputBaseClass} border-slate-300`

  // ── Step label for subtitle ───────────────

  const stepSubtitle =
    step === 'role'     ? 'Access restricted to authorized DNPPO personnel' :
    step === 'otp'      ? `Enter the verification code sent to your registered email` :
                          'Enter your password to complete sign in'

  // ── Step indicator dots ───────────────────

  const steps: Step[] = ['role', 'otp', 'password']
  const stepIndex = steps.indexOf(step)

  return (
    <div className="min-h-screen flex font-sans">

      {/* ── Left: Branding ── */}
      <div
        className="flex-1 relative overflow-hidden flex flex-col justify-center px-16 bg-cover bg-center"
        style={{ backgroundColor: '#2e4769' }}
      >
        <Image
          src="/assets/pnp-bg.jpg"
          alt=""
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-[#2e4769]/75 mix-blend-overlay" />

        {/* DNPPO Badge */}
        <div className="inline-flex w-fit mb-6 items-center gap-3 border-[3px] border-[#fde047] rounded-full pl-2 pr-6 py-1.5 bg-[#1b365d]/80 backdrop-blur-sm shadow-xl">
          <Image
            src="/assets/dnppo-logo.png"
            alt="DNPPO Logo"
            width={48}
            height={48}
            priority
            sizes="48px"
            className="w-12 h-12 rounded-full bg-white object-contain"
          />
          <span className="text-[#fde047] font-serif text-lg leading-tight font-medium tracking-wide">
            Davao Norte Police Provincial Office
          </span>
        </div>

        {/* Headings */}
        <div
          className="relative z-10 max-w-2xl"
          style={{ textShadow: '5px 2px 5px rgba(0,0,0,0.8)' }}
        >
          <h1 className="font-serif text-[4rem] text-[#fde047] leading-[1.1] mb-6 drop-shadow-lg font-bold">
            Records Management<br />System
          </h1>
          <p className="text-[#fde047] text-lg leading-snug max-w-lg drop-shadow-md font-medium">
            Secure, centralized document management for Davao Norte Provincial Police Office personnel
          </p>
        </div>

        {/* Faded PNP Logo */}
        <div className="absolute top-10 right-10 pointer-events-none">
          <Image
            src="/assets/pnp-logo.png"
            alt="PNP Background"
            width={250}
            height={250}
            sizes="300px"
            className="w-[150px] h-auto drop-shadow-2xl"
          />
        </div>
      </div>


      {reason === 'account_disabled' && (
          <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-800">
            Your account has been disabled. Contact your system administrator.
          </div>
        )}
      {/* ── Right: Login Form ── */}
      <div className="w-[500px] bg-white px-12 py-10 flex flex-col relative shadow-2xl z-20">
        <div className="flex-1 flex flex-col justify-center items-center w-full">

          {/* Header */}
          <div className="text-center mb-8 w-full">
            <h2 className="font-serif text-[2.5rem] text-[#1b365d] font-bold mb-2 flex items-center justify-center gap-3">
              <span className="text-[#fde047] text-2xl">⭐</span>
              Sign In
              <span className="text-[#fde047] text-2xl">⭐</span>
            </h2>
            <p className="text-slate-500 text-sm font-medium">{stepSubtitle}</p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-8">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`
                  w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                  transition-all duration-300
                  ${i < stepIndex
                    ? 'bg-emerald-500 text-white'
                    : i === stepIndex
                      ? 'bg-[#1b365d] text-[#fde047]'
                      : 'bg-slate-100 text-slate-400'
                  }
                `}>
                  {i < stepIndex ? '✓' : i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div className={`w-8 h-0.5 transition-all duration-300 ${i < stepIndex ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                )}
              </div>
            ))}
            <span className="ml-2 text-xs text-slate-400 font-medium">
              {step === 'role' ? 'Select role' : step === 'otp' ? 'Verify email' : 'Enter password'}
            </span>
          </div>

          {/* Error banner */}
          {error && (
            <div className="w-full bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg text-center mb-4">
              {error}
            </div>
          )}

          {/* ── Step 1: Role selector + Send OTP ── */}
          {step === 'role' && (
            <form onSubmit={handleSendOtp} noValidate className="w-full space-y-6">
              <div className="w-full">
                <label className="block text-[#1b365d] font-bold text-base mb-2">
                  Role
                </label>
                <select
                  value={roleId}
                  onChange={e => { setRoleId(e.target.value); setError('') }}
                  className={inputClass}
                  disabled={loading}
                >
                  <option value="" disabled>Select your admin role</option>
                  {ROLE_OPTIONS.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1.5">
                  A verification code will be sent to your registered email.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !roleId}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold
                           py-3.5 rounded-lg transition text-base disabled:opacity-70 shadow-md"
              >
                {loading ? 'Sending code…' : 'Send Verification Code →'}
              </button>
            </form>
          )}

          {/* ── Step 2: OTP ── */}
          {step === 'otp' && (
            <form onSubmit={handleVerifyOtp} noValidate className="w-full space-y-6">

              {/* Role chip — shows which role they selected */}
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-[#1b365d] flex-shrink-0" />
                <span className="text-xs text-slate-500 font-medium truncate">
                  {getRoleLabel(roleId)}
                </span>
                <button
                  type="button"
                  onClick={() => { setStep('role'); setOtp(''); setError('') }}
                  className="ml-auto text-xs text-blue-500 hover:text-blue-700 font-semibold whitespace-nowrap"
                >
                  Change
                </button>
              </div>

              <div className="w-full">
                <label className="block text-[#1b365d] font-bold text-base mb-2">
                  Verification Code
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={e => { setOtp(e.target.value.replace(/\D/g, '')); setError('') }}
                  placeholder="123456"
                  className={`${inputClass} text-center tracking-[0.5em] text-xl font-bold`}
                  disabled={loading}
                />
                <p className="text-xs text-slate-400 mt-1.5">
                  Code expires in 10 minutes. Check your registered email inbox.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || otp.length < 6}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold
                           py-3.5 rounded-lg transition text-base disabled:opacity-70 shadow-md"
              >
                {loading ? 'Verifying…' : 'Verify Code →'}
              </button>

              <button
                type="button"
                onClick={() => { setStep('role'); setOtp(''); setError('') }}
                className="w-full text-sm text-slate-400 hover:text-slate-600 transition"
              >
                ← Back to role selection
              </button>
            </form>
          )}

          {/* ── Step 3: Password ── */}
          {step === 'password' && (
            <form onSubmit={handlePassword} noValidate className="w-full space-y-6">

              {/* Role chip */}
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="text-xs text-slate-500 font-medium truncate">
                  {getRoleLabel(roleId)} — Email verified ✓
                </span>
              </div>

              <div className="w-full">
                <label className="block text-[#1b365d] font-bold text-base mb-2">
                  Password
                </label>
                <input
                  type="password"
                  required
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  placeholder="Enter your password"
                  className={inputClass}
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading || !password}
                className="w-full bg-[#1b365d] hover:bg-[#152a4a] text-[#fde047] font-semibold
                           py-3.5 rounded-lg transition text-base disabled:opacity-70 shadow-md"
              >
                {loading ? 'Signing in…' : 'SIGN IN'}
              </button>
            </form>
          )}

          <div className="text-center mt-8 text-[11px] text-slate-400 leading-relaxed font-medium">
            <p>Access credentials are issued by your system administrator</p>
            <p>No public registration available.</p>
          </div>

        </div>

        {/* STI Footer */}
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
    </div>
  )
}