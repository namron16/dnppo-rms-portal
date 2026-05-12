'use client'

import { useState, useCallback, Suspense } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { getDefaultAdminRoute, type SessionRole } from '@/lib/adminRouteAccess'

const ROLE_EMAIL_MAP: Record<string, string> = {
  admin: 'dalenamron@gmail.com',
  PD:    'pd@dnppo.gov.ph',
  DPDA:  'dpda@dnppo.gov.ph',
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

const ROLE_OPTIONS = Object.keys(ROLE_EMAIL_MAP).map(id => ({
  id, label: getRoleLabel(id),
}))

function LoginForm() {
  const { loginPassword } = useAuth()
  const router       = useRouter()
  const searchParams = useSearchParams()
  const reason       = searchParams.get('reason')

  const [roleId,   setRoleId]   = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const selectedEmail = ROLE_EMAIL_MAP[roleId] ?? ''

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!roleId)    { setError('Please select your role.'); return }
    if (!password)  { setError('Please enter your password.'); return }

    setLoading(true)
    const { error } = await loginPassword(selectedEmail, password)
    setLoading(false)

    if (error) {
      setError('Invalid credentials. Please check your role and password.')
      return
    }

    router.replace(getDefaultAdminRoute(roleId as SessionRole))
  }, [roleId, selectedEmail, password, loginPassword, router])

  const inputBase =
    'w-full px-4 py-3 border rounded-lg text-sm text-slate-800 bg-white ' +
    'focus:outline-none focus:ring-2 focus:ring-[#1b365d]/50 transition'
  const inputCls = error ? `${inputBase} border-red-300` : `${inputBase} border-slate-300`

  return (
    <div className="w-[500px] bg-white px-12 py-10 flex flex-col relative shadow-2xl z-20">
      <div className="flex-1 flex flex-col justify-center items-center w-full">

        {reason === 'account_disabled' && (
          <div className="w-full mb-4 rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-800">
            Your account has been disabled. Contact your system administrator.
          </div>
        )}

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

        {error && (
          <div className="w-full bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg text-center mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="w-full space-y-6">
          <div>
            <label className="block text-[#1b365d] font-bold text-base mb-2">Role</label>
            <select
              value={roleId}
              onChange={e => { setRoleId(e.target.value); setError('') }}
              className={inputCls}
              disabled={loading}
            >
              <option value="" disabled>Select your admin role</option>
              {ROLE_OPTIONS.map(r => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[#1b365d] font-bold text-base mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder="Enter your password"
              className={inputCls}
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
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex font-sans">

      {/* Left: Branding */}
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

      {/* Right: Login form */}
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