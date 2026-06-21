'use client'
// app/admin/gdrive/page.tsx
// Google Drive Storage Pool — Admin Management Dashboard

import { useEffect, useState, useCallback } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/lib/auth'
import { logGDriveConnect, logGDriveReconnect, logGDriveDisconnect } from '@/lib/adminLogger'
import type { SystemHealthReport, AccountHealthResult } from '@/lib/gdrive-pool/types'

// =============================================================================
// TYPES
// =============================================================================

interface PoolAccountStatus {
  id: string
  accountEmail: string
  label: string
  ownerUsername: string
  status: 'ACTIVE' | 'ERROR' | 'MAINTENANCE'
  isActive: boolean
  usageGb: number
  quotaGb: number
  usagePct: number
  fileCount: number
  errorMessage: string | null
  lastHealthCheck: string | null
  connectedAt: string
}

interface StatusResponse {
  quickStatus: {
    totalAccounts: number
    healthyAccounts: number
    totalUsedGb: number
    totalQuotaGb: number
    usagePct: number
    hasErrors: boolean
  }
  summary: {
    total_accounts: number
    active_accounts: number
    error_accounts: number
    total_quota_gb: number
    total_used_gb: number
    total_files: number
    overall_usage_pct: number
  }
  accounts: PoolAccountStatus[]
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function UsageBar({ pct, className = '' }: { pct: number; className?: string }) {
  const color =
    pct >= 95 ? 'bg-red-500'
    : pct >= 80 ? 'bg-amber-500'
    : pct >= 60 ? 'bg-blue-500'
    : 'bg-emerald-500'

  return (
    <div className={`h-2 w-full bg-slate-100 rounded-full overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  )
}

function StatusPill({ status, isActive }: { status: string; isActive: boolean }) {
  if (!isActive || status === 'ERROR') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        {status === 'MAINTENANCE' ? 'Disconnected' : 'Error'}
      </span>
    )
  }
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Active
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      {status}
    </span>
  )
}

function HealthStatusBadge({ status }: { status: AccountHealthResult['status'] }) {
  const cfg = {
    healthy:        { cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: '✅', label: 'Healthy' },
    degraded:       { cls: 'bg-amber-100 text-amber-700 border-amber-200',       icon: '⚠️', label: 'Degraded' },
    unreachable:    { cls: 'bg-red-100 text-red-700 border-red-200',             icon: '🔴', label: 'Unreachable' },
    auth_error:     { cls: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200', icon: '🔑', label: 'Auth Error' },
    quota_exceeded: { cls: 'bg-orange-100 text-orange-700 border-orange-200',    icon: '📦', label: 'Quota Full' },
  }[status] ?? { cls: 'bg-slate-100 text-slate-500 border-slate-200', icon: '❓', label: status }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${cfg.cls}`}>
      {cfg.icon} {cfg.label}
    </span>
  )
}

// ── Single connected Drive account card ────────────────────────────────────

function DriveAccountCard({
  account,
  healthResult,
  onDisconnect,
  onReconnect,
}: {
  account: PoolAccountStatus
  healthResult?: AccountHealthResult
  onDisconnect: (id: string, email: string) => void
  onReconnect: (username: string, email: string) => void
}) {
  return (
    <div className={`bg-white border rounded-xl p-4 flex flex-col gap-2.5 transition ${
      account.status === 'ERROR' ? 'border-red-200 bg-red-50/20' : 'border-slate-200'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-800 truncate">{account.accountEmail}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{account.label}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <StatusPill status={account.status} isActive={account.isActive} />
          {healthResult && <HealthStatusBadge status={healthResult.status} />}
        </div>
      </div>

      {/* Storage bar */}
      <div>
        <div className="flex justify-between text-[10px] text-slate-500 mb-1">
          <span>{account.usageGb.toFixed(2)} GB used</span>
          <span>{account.usagePct.toFixed(1)}% of {account.quotaGb.toFixed(0)} GB</span>
        </div>
        <UsageBar pct={account.usagePct} />
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[10px] text-slate-500">
        <span>📄 {account.fileCount.toLocaleString()} files</span>
        {account.lastHealthCheck && (
          <span>🕐 {new Date(account.lastHealthCheck).toLocaleTimeString('en-PH')}</span>
        )}
      </div>

      {/* Error */}
      {account.errorMessage && (
        <div className="px-2.5 py-1.5 bg-red-50 border border-red-100 rounded-lg text-[10px] text-red-700 font-medium">
          ⚠️ {account.errorMessage}
        </div>
      )}

      {/* Health recommendations */}
      {healthResult?.recommendations.map((rec, i) => (
        <div key={i} className="px-2.5 py-1.5 bg-amber-50 border border-amber-100 rounded-lg text-[10px] text-amber-800">
          {rec}
        </div>
      ))}

      {healthResult && healthResult.latencyMs > 0 && (
        <p className="text-[10px] text-slate-400">Latency: {healthResult.latencyMs}ms</p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-0.5">
        <button
          onClick={() => onReconnect(account.ownerUsername, account.accountEmail)}
          className="flex-1 py-1.5 rounded-lg border border-blue-200 text-blue-600 text-[10px] font-semibold hover:bg-blue-50 transition"
        >
          Reconnect
        </button>
        <button
          onClick={() => onDisconnect(account.id, account.accountEmail)}
          className="flex-1 py-1.5 rounded-lg border border-red-200 text-red-600 text-[10px] font-semibold hover:bg-red-50 transition"
        >
          Disconnect
        </button>
      </div>
    </div>
  )
}

// ── Per-user section ───────────────────────────────────────────────────────

function UserDriveSection({
  username,
  accounts,
  healthReport,
  onConnect,
  onDisconnect,
  onReconnect,
  isDpda,
}: {
  username: string
  accounts: PoolAccountStatus[]
  healthReport: SystemHealthReport | null
  onConnect: (username: string) => void
  onDisconnect: (id: string, email: string) => void
  onReconnect: (username: string, email: string) => void
  isDpda?: boolean
}) {
  const connectedCount = accounts.filter(a => a.isActive).length
  const totalGb = accounts.reduce((s, a) => s + a.quotaGb, 0)
  const usedGb  = accounts.reduce((s, a) => s + a.usageGb, 0)
  const hasError = accounts.some(a => a.status === 'ERROR')

  return (
    <div className={`rounded-2xl border-[1.5px] overflow-hidden ${
      isDpda
        ? 'border-blue-200 bg-blue-50/30'
        : hasError
          ? 'border-red-100 bg-red-50/10'
          : 'border-slate-200 bg-white'
    }`}>
      {/* Section header */}
      <div className={`px-4 py-3 flex items-center justify-between gap-3 border-b ${
        isDpda ? 'border-blue-200 bg-blue-50/50' : 'border-slate-100 bg-slate-50/80'
      }`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
            isDpda ? 'bg-blue-600 text-white' : 'bg-slate-700 text-white'
          }`}>
            {username === 'DPDA' ? 'DA' : username}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">
              {isDpda ? 'DPDA (Deputy Director for Administration)' : username}
            </p>
            <p className="text-[10px] text-slate-400">
              {connectedCount === 0
                ? 'No Drive accounts connected'
                : `${connectedCount} account${connectedCount > 1 ? 's' : ''} · ${usedGb.toFixed(2)} / ${totalGb.toFixed(0)} GB`
              }
            </p>
          </div>
        </div>

        <button
          onClick={() => onConnect(username)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition flex-shrink-0 ${
            isDpda
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-slate-800 hover:bg-slate-900 text-white'
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Drive Account
        </button>
      </div>

      {/* Drive account cards */}
      <div className="p-4">
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <div className="text-3xl mb-2">☁️</div>
            <p className="text-xs font-semibold text-slate-600 mb-1">No Google Drive connected</p>
            <p className="text-[10px] text-slate-400 mb-3">
              Click "Add Drive Account" to connect {isDpda ? 'DPDA\'s' : `${username}'s`} Google Drive.
            </p>
            <button
              onClick={() => onConnect(username)}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition"
            >
              Connect Google Drive
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {accounts.map(account => {
              const health = healthReport?.accounts.find(
                h => h.poolAccountId === account.id
              )
              return (
                <DriveAccountCard
                  key={account.id}
                  account={account}
                  healthResult={health}
                  onDisconnect={onDisconnect}
                  onReconnect={onReconnect}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function GDriveAdminPage() {
  const { toast } = useToast()
  const { user }  = useAuth()

  const [status,        setStatus]        = useState<StatusResponse | null>(null)
  const [healthReport,  setHealthReport]  = useState<SystemHealthReport | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [loadingHealth, setLoadingHealth] = useState(false)
  const [repairing,     setRepairing]     = useState(false)
  const [scanning,      setScanning]      = useState(false)

  const [allUsers, setAllUsers] = useState<string[]>([
    'DPDA', 'DPDO','P1','P2','P3','P4','P5','P6','P7','P8','P9','P10','WCPD','PPSMU'
  ])

  useEffect(() => {
    async function loadUsers() {
      const res  = await fetch('/api/gdrive/status')
      const json = await res.json()
      if (json.data?.accounts) {
        const { createClient } = await import('@/lib/supabase/client')
        const supabase = createClient()
        const { data } = await supabase
          .from('role_registry')
          .select('role')
          .eq('is_active', true)
          .neq('role', 'admin')
          .neq('role', 'PD')
          .order('sort_order')
        if (data) setAllUsers(data.map((r: { role: string }) => r.role))
      }
    }
    void loadUsers()
  }, [])

  // ── Load status ──────────────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const res  = await fetch('/api/gdrive/status')
      const json = await res.json()
      if (json.data) setStatus(json.data)
    } catch {
      toast.error('Failed to load Drive pool status.')
    } finally {
      setLoadingStatus(false)
    }
  }, [toast])

  useEffect(() => { void loadStatus() }, [loadStatus])

  // Handle OAuth redirect back
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === 'true') {
      const email    = params.get('email')    ?? 'unknown'
      const username = params.get('username') ?? ''
      toast.success(`Google Drive connected for ${username}: ${email}`)
      window.history.replaceState({}, '', '/admin/gdrive')
      void loadStatus()
    }
    if (params.get('error')) {
      toast.error(`Connection failed: ${decodeURIComponent(params.get('error')!)}`)
      window.history.replaceState({}, '', '/admin/gdrive')
    }
  }, [toast, loadStatus])

  // ── Health check ─────────────────────────────────────────────────────────
  async function runHealthCheck() {
    setLoadingHealth(true)
    toast.info('Running health checks…')
    try {
      const res  = await fetch('/api/gdrive/health')
      const json = await res.json()
      if (json.data) {
        setHealthReport(json.data)
        toast.success(`Health check complete: ${json.data.overallStatus}`)
      }
    } catch {
      toast.error('Health check failed.')
    } finally {
      setLoadingHealth(false)
      await loadStatus()
    }
  }

  // ── Repair ───────────────────────────────────────────────────────────────
  async function runRepair() {
    setRepairing(true)
    try {
      const res  = await fetch('/api/gdrive/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'repair' }),
      })
      const json = await res.json()
      const r    = json.data
      if (r) {
        toast.success(`Repair: ${r.repaired}/${r.attempted} accounts restored.`)
        if (r.stillBroken.length > 0) {
          toast.warning(`Still broken: ${r.stillBroken.join(', ')}`)
        }
      }
    } catch {
      toast.error('Repair request failed.')
    } finally {
      setRepairing(false)
      await loadStatus()
    }
  }

  // ── File scan ────────────────────────────────────────────────────────────
  async function runFileScan() {
    setScanning(true)
    toast.info('Scanning file accessibility…')
    try {
      const res  = await fetch('/api/gdrive/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan_files' }),
      })
      const json = await res.json()
      const r    = json.data
      if (r) toast.success(`Scan: ${r.checked} checked, ${r.inaccessible} inaccessible.`)
    } catch {
      toast.error('File scan failed.')
    } finally {
      setScanning(false)
    }
  }

  // ── Connect (OAuth redirect) — logs BEFORE redirect so it's captured ──────
  // Note: the browser navigates away immediately after this, so we fire the log
  // first (awaited), then redirect. The log records the *intent* to connect.
  // The OAuth callback route should also log a confirmation on success.
  async function handleConnect(username: string) {
    await logGDriveConnect(username)
    window.location.href = `/api/gdrive/connect?username=${encodeURIComponent(username)}`
  }

  // ── Reconnect — separate log action from a fresh connect ─────────────────
  // Called by DriveAccountCard's Reconnect button, which passes the account email.
  async function handleReconnect(username: string, accountEmail: string) {
    await logGDriveReconnect(username, accountEmail)
    window.location.href = `/api/gdrive/connect?username=${encodeURIComponent(username)}`
  }

  // ── Disconnect ───────────────────────────────────────────────────────────
  async function handleDisconnect(poolId: string, email: string) {
    if (!confirm(
      `Disconnect ${email}?\n\n` +
      `Their files remain in Google Drive but become inaccessible in the system.`
    )) return

    try {
      const res  = await fetch('/api/gdrive/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poolAccountId: poolId }),
      })
      const json = await res.json()
      if (json.data?.success) {
        // Find owner username for the log (look up in current status)
        const account  = status?.accounts.find(a => a.id === poolId)
        const username = account?.ownerUsername ?? 'unknown'
        await logGDriveDisconnect(email, username)
        toast.success(json.data.message)
        await loadStatus()
      } else {
        toast.error(json.error ?? 'Disconnect failed.')
      }
    } catch {
      toast.error('Disconnect request failed.')
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function getAccountsForUser(username: string): PoolAccountStatus[] {
    if (!status?.accounts) return []
    return status.accounts.filter(a => a.ownerUsername === username)
  }

  const s = status?.summary
  const q = status?.quickStatus

  const overallColor =
    healthReport?.overallStatus === 'healthy'  ? 'text-emerald-600'
    : healthReport?.overallStatus === 'degraded' ? 'text-amber-600'
    : healthReport?.overallStatus === 'critical' ? 'text-red-600'
    : 'text-slate-600'

  const totalCapacityGb = status?.accounts
    .filter(a => a.isActive)
    .reduce((s, a) => s + a.quotaGb, 0) ?? 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <PageHeader title="Google Drive Storage Pool" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50">

        {/* ── Summary Cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: '🔗', label: 'Connected Accounts', value: q ? `${q.healthyAccounts}/${q.totalAccounts}` : '—', color: 'bg-blue-50' },
            { icon: '💾', label: 'Total Storage Used',  value: s ? `${s.total_used_gb} GB`  : '—', color: 'bg-violet-50' },
            { icon: '📦', label: 'Total Capacity',      value: `${totalCapacityGb.toFixed(0)} GB`, color: 'bg-emerald-50' },
            { icon: '📄', label: 'Total Files',         value: s ? (s.total_files ?? 0).toLocaleString() : '—', color: 'bg-amber-50' },
          ].map(card => (
            <div key={card.label} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${card.color}`}>
                {card.icon}
              </div>
              <div>
                <p className="text-xl font-extrabold text-slate-800">{card.value}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{card.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Overall usage bar ── */}
        {s && (
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex justify-between text-xs text-slate-600 mb-2 font-medium">
              <span>Overall Pool Usage</span>
              <span className="font-bold">{s.overall_usage_pct}%</span>
            </div>
            <UsageBar pct={s.overall_usage_pct} />
            <p className="text-[10px] text-slate-400 mt-1.5">
              {s.total_used_gb} GB used of {s.total_quota_gb} GB across {s.total_accounts} accounts
            </p>
          </div>
        )}

        {/* ── Actions bar ── */}
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-2.5 flex-wrap">
          <span className="text-xs font-semibold text-slate-600 mr-1">Maintenance:</span>

          <Button variant="primary" size="sm" onClick={runHealthCheck} disabled={loadingHealth}>
            {loadingHealth ? '⏳ Checking…' : '🩺 Run Health Check'}
          </Button>
          <Button variant="outline" size="sm" onClick={runRepair} disabled={repairing}>
            {repairing ? '🔧 Repairing…' : '🔧 Repair Broken'}
          </Button>
          <Button variant="outline" size="sm" onClick={runFileScan} disabled={scanning}>
            {scanning ? '🔍 Scanning…' : '🔍 Scan Files'}
          </Button>
          <Button variant="ghost" size="sm" onClick={loadStatus} disabled={loadingStatus}>
            🔄 Refresh
          </Button>

          {healthReport && (
            <span className={`ml-auto text-xs font-bold ${overallColor}`}>
              System: {healthReport.overallStatus.toUpperCase()}
            </span>
          )}
        </div>

        {/* ── Global Recommendations ── */}
        {healthReport && healthReport.recommendations.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-1.5">
            <p className="text-xs font-bold text-amber-800 uppercase tracking-widest mb-2">
              ⚠️ Recommendations
            </p>
            {healthReport.recommendations.slice(0, 8).map((rec, i) => (
              <p key={i} className="text-xs text-amber-800">{rec}</p>
            ))}
          </div>
        )}

        {/* ── DPDA Section (special) ── */}
        <div>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
            Admin Drive Pool
          </h2>
          <UserDriveSection
            username="DPDA"
            accounts={getAccountsForUser('DPDA')}
            healthReport={healthReport}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onReconnect={handleReconnect}
            isDpda
          />
        </div>

        {/* ── P1–P10 Sections ── */}
        <div>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
            User Drive Pools (P1–P10, WCPD, PPSMU)
          </h2>
          <div className="space-y-4">
            {allUsers.filter(u => u !== 'DPDA').map(username => (
              <UserDriveSection
                key={username}
                username={username}
                accounts={getAccountsForUser(username)}
                healthReport={healthReport}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                onReconnect={handleReconnect}
              />
            ))}
          </div>
        </div>

        {/* ── Health Check Details Table ── */}
        {healthReport && healthReport.accounts.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                Last Health Check Results
              </h3>
              <span className="text-[10px] text-slate-400">
                {new Date(healthReport.checkedAt).toLocaleString('en-PH')}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Owner', 'Account', 'Label', 'Health', 'Latency', 'Used', 'Quota', 'Files', 'Token'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {healthReport.accounts.map(acc => (
                    <tr key={acc.poolAccountId} className="border-b border-slate-50 hover:bg-slate-50 transition">
                      <td className="px-4 py-3 font-bold text-slate-700">{acc.ownerUsername}</td>
                      <td className="px-4 py-3 text-slate-600">{acc.accountEmail}</td>
                      <td className="px-4 py-3 text-slate-400 text-[10px]">{acc.label}</td>
                      <td className="px-4 py-3"><HealthStatusBadge status={acc.status} /></td>
                      <td className="px-4 py-3 text-slate-600">
                        {acc.latencyMs > 0 ? `${acc.latencyMs}ms` : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {(acc.usedBytes / 1073741824).toFixed(2)} GB
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {(acc.quotaBytes / 1073741824).toFixed(0)} GB
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {acc.fileCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {acc.tokenValid
                          ? <span className="text-emerald-600 font-semibold">✅ Valid</span>
                          : <span className="text-red-600 font-semibold">❌ Invalid</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Instructions ── */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-800 space-y-1.5">
          <p className="font-bold mb-2">ℹ️ How Drive Account Ownership Works</p>
          <p>• Each user (DPDA, P1–P10) has their own isolated Drive pool. Uploads by P1 always go to <strong>P1's Drive accounts only</strong> — never to P2's or any other user's Drive.</p>
          <p>• Each user can have <strong>multiple Drive accounts</strong> connected. When one account fills up, uploads automatically spill over to the next available account for that user.</p>
          <p>• Click <strong>"Add Drive Account"</strong> on any user section to start the OAuth flow. The user must sign in with their Google account and grant access.</p>
          <p>• DPDA has a separate pool for admin-level document uploads.</p>
          <p className="pt-1 text-blue-600 font-medium">
            ⚡ Each Google account provides 15 GB free. Connect multiple accounts per user to increase their storage capacity.
          </p>
        </div>

      </div>
    </div>
  )
}