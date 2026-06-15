'use client'
// app/admin/organization/page.tsx
// Auto-layout top-down org chart — orthogonal lines, zoom, confirm dialog.

import { useState, useEffect, useRef } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Modal }      from '@/components/ui/Modal'
import { Button }     from '@/components/ui/Button'
import { useToast }   from '@/components/ui/Toast'
import { useRealtimeOrgMembers } from '@/hooks/useRealtimeCollections'
import { useAuth }    from '@/lib/auth'
import { logAddOrgMember, logEditOrgMember, logDeleteOrgMember } from '@/lib/adminLogger'
import { supabase }   from '@/lib/supabase'

// ── Types ──────────────────────────────────────
interface OrgMember {
  id: string
  name: string
  rank: string
  position: string
  unit?: string
  contactNo?: string
  photoUrl?: string
  initials: string
  color: string
  parentId?: string
}

type OrgMemberRow = {
  id: string
  name: string
  rank: string | null
  position: string
  unit: string | null
  contact_no: string | null
  photo_url: string | null
  initials: string
  color: string
  parent_id: string | null
}

// ── Layout constants ───────────────────────────
const CARD_W     = 260
const CARD_H     = 270
const H_GAP      = 56
const V_GAP      = 80
const CANVAS_PAD = 80

const COLORS = [
  '#3b63b8', '#f0b429', '#8b5cf6', '#10b981',
  '#ef4444', '#0891b2', '#f97316', '#ec4899',
]

const RANK_ORDER = [
  'P/GEN.',
  'P/LT. GEN.',
  'P/MAJ. GEN.',
  'P/BRIG. GEN.',
  'P/COL.',
  'P/LT. COL.',
  'P/MAJ.',
  'P/CAPT.',
  'P/LT.',
  'P/INSP.',
  'PSMS',
  'PMMS',
  'PEMS',
  'PSSG',
  'PCPL',
  'PAT',
  'PNCOP',
]

function normalizeRank(rank?: string) {
  return (rank ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
}

function rankPriority(rank?: string) {
  const idx = RANK_ORDER.indexOf(normalizeRank(rank))
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
}

function compareMembersByRank(a: OrgMember, b: OrgMember) {
  const rankDiff = rankPriority(a.rank) - rankPriority(b.rank)
  if (rankDiff !== 0) return rankDiff

  const posDiff = a.position.localeCompare(b.position, undefined, { sensitivity: 'base' })
  if (posDiff !== 0) return posDiff

  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

function getDisplayMembersWithAutoHierarchy(members: OrgMember[]): OrgMember[] {
  if (members.length <= 1) return members

  const byId = new Map(members.map(m => [m.id, m]))
  const sorted = [...members].sort(compareMembersByRank)
  const autoParentById = new Map<string, string | undefined>()

  for (let i = 0; i < sorted.length; i++) {
    const member = sorted[i]

    // Manual reporting line always wins when valid.
    if (member.parentId && byId.has(member.parentId)) {
      autoParentById.set(member.id, member.parentId)
      continue
    }

    const memberPriority = rankPriority(member.rank)
    let parentId: string | undefined

    // Find nearest higher-ranked person and place this member below them.
    for (let j = i - 1; j >= 0; j--) {
      const candidate = sorted[j]
      if (rankPriority(candidate.rank) < memberPriority) {
        parentId = candidate.id
        break
      }
    }

    autoParentById.set(member.id, parentId)
  }

  return members.map(member => ({
    ...member,
    parentId: autoParentById.get(member.id),
  }))
}

const LOCAL_KEY = 'ddnppo_org_members_v2'

function loadMembers(): OrgMember[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') } catch { return [] }
}
function saveMembers(m: OrgMember[]) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(m)) } catch {}
}

function fromDbRow(row: OrgMemberRow): OrgMember {
  return {
    id: row.id,
    name: row.name,
    rank: row.rank ?? '',
    position: row.position,
    unit: row.unit ?? undefined,
    contactNo: row.contact_no ?? undefined,
    photoUrl: row.photo_url ?? undefined,
    initials: row.initials,
    color: row.color,
    parentId: row.parent_id ?? undefined,
  }
}

function toDbRow(member: OrgMember): OrgMemberRow {
  return {
    id: member.id,
    name: member.name,
    rank: member.rank || null,
    position: member.position,
    unit: member.unit || null,
    contact_no: member.contactNo || null,
    photo_url: member.photoUrl || null,
    initials: member.initials,
    color: member.color,
    parent_id: member.parentId || null,
  }
}

async function loadMembersFromSupabase(): Promise<OrgMember[] | null> {
  try {
    const { data, error } = await supabase
      .from('org_members')
      .select('*')

    if (error) {
      console.warn('Supabase unavailable (org_members load):', error.message)
      return null
    }

    return (data ?? []).map((row: any) => fromDbRow(row as OrgMemberRow))
  } catch (e) {
    console.warn('Supabase unavailable (org_members load):', e)
    return null
  }
}

async function syncMembersToSupabase(members: OrgMember[]): Promise<boolean> {
  try {
    const rows = members.map(toDbRow)

    if (rows.length > 0) {
      const { error: upsertError } = await supabase
        .from('org_members')
        .upsert(rows, { onConflict: 'id' })
      if (upsertError) {
        console.warn('Supabase unavailable (org_members upsert):', upsertError.message)
        return false
      }
    }

    const { data: existing, error: existingError } = await supabase
      .from('org_members')
      .select('id')

    if (existingError) {
      console.warn('Supabase unavailable (org_members select ids):', existingError.message)
      return false
    }

    const keepIds = new Set(members.map(m => m.id))
    const deleteIds = (existing ?? [])
      .map((r: any) => r.id as string)
      .filter((id: string) => !keepIds.has(id))

    if (deleteIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('org_members')
        .delete()
        .in('id', deleteIds)
      if (deleteError) {
        console.warn('Supabase unavailable (org_members delete stale):', deleteError.message)
        return false
      }
    }

    return true
  } catch (e) {
    console.warn('Supabase unavailable (org_members sync):', e)
    return false
  }
}

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

// ── Auto-layout algorithm ──────────────────────
interface LayoutNode {
  member: OrgMember
  x: number
  y: number
  subtreeWidth: number
}

function buildLayoutMap(members: OrgMember[]): Map<string, LayoutNode> {
  const byId       = new Map(members.map(m => [m.id, m]))
  const childrenOf = new Map<string | undefined, OrgMember[]>()

  for (const m of members) {
    const key = m.parentId
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(m)
  }

  for (const [, children] of childrenOf) {
    children.sort(compareMembersByRank)
  }

  function subtreeWidth(id: string): number {
    const children = childrenOf.get(id) ?? []
    if (children.length === 0) return CARD_W
    const total = children.reduce((s, c) => s + subtreeWidth(c.id) + H_GAP, -H_GAP)
    return Math.max(CARD_W, total)
  }

  const result = new Map<string, LayoutNode>()

  function place(id: string, x: number, y: number) {
    const member   = byId.get(id)!
    const children = childrenOf.get(id) ?? []
    const sw       = subtreeWidth(id)
    result.set(id, { member, x, y, subtreeWidth: sw })
    if (children.length === 0) return
    const totalChildW = children.reduce((s, c) => s + subtreeWidth(c.id) + H_GAP, -H_GAP)
    let cx = x - totalChildW / 2
    for (const child of children) {
      const csw = subtreeWidth(child.id)
      place(child.id, cx + csw / 2, y + CARD_H + V_GAP)
      cx += csw + H_GAP
    }
  }

  const roots = members
    .filter(m => !m.parentId || !byId.has(m.parentId))
    .sort(compareMembersByRank)
  let rx = 0
  for (const root of roots) {
    const sw = subtreeWidth(root.id)
    place(root.id, rx + sw / 2, 0)
    rx += sw + H_GAP
  }

  if (result.size === 0) return result
  const minX = Math.min(...[...result.values()].map(n => n.x - CARD_W / 2))
  const shift = -minX + CANVAS_PAD
  for (const [k, v] of result) {
    result.set(k, { ...v, x: v.x + shift, y: v.y + CANVAS_PAD })
  }
  return result
}

// ── Orthogonal connector lines ─────────────────
function Lines({ layout }: { layout: Map<string, LayoutNode> }) {
  const lines: React.ReactNode[] = []
  const childrenByParent = new Map<string, LayoutNode[]>()

  for (const [, node] of layout) {
    if (!node.member.parentId) continue
    const pid = node.member.parentId
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, [])
    childrenByParent.get(pid)!.push(node)
  }

  for (const [parentId, children] of childrenByParent) {
    const parent = layout.get(parentId)
    if (!parent) continue

    const px   = parent.x
    const py   = parent.y + CARD_H
    const busY = py + V_GAP / 2

    // Vertical from parent bottom → bus
    lines.push(
      <line key={`vdown-${parentId}`}
        x1={px} y1={py} x2={px} y2={busY}
        stroke="#94a3b8" strokeWidth="1.5"
      />
    )

    // Horizontal bus across all children
    if (children.length > 1) {
      const xs  = children.map(c => c.x)
      const min = Math.min(px, ...xs)
      const max = Math.max(px, ...xs)
      lines.push(
        <line key={`bus-${parentId}`}
          x1={min} y1={busY} x2={max} y2={busY}
          stroke="#94a3b8" strokeWidth="1.5"
        />
      )
    }

    // Vertical from bus → each child top
    for (const child of children) {
      lines.push(
        <line key={`vchild-${parentId}-${child.member.id}`}
          x1={child.x} y1={busY} x2={child.x} y2={child.y}
          stroke="#94a3b8" strokeWidth="1.5"
        />
      )
    }
  }

  return <>{lines}</>
}

// ── Member Card (bigger, more info, inline actions) ──
const ACTION_H = 36

function MemberCard({ node, selected, onClick, onEdit, onDelete, onAddChild, canManage }: {
  node: LayoutNode
  selected: boolean
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
  onAddChild: () => void
  canManage: boolean
}) {
  const { member, x, y } = node
  const avatarCX = CARD_W / 2
  const avatarCY = 58

  return (
    <g transform={`translate(${x - CARD_W / 2}, ${y})`} style={{ cursor: 'pointer' }}
      onClick={e => { e.stopPropagation(); onClick() }}>

      {/* Shadow */}
      <rect x={3} y={6} width={CARD_W} height={CARD_H} rx={20} fill="rgba(15,23,42,0.13)" />

      {/* Body */}
      <rect x={0} y={0} width={CARD_W} height={CARD_H} rx={20}
        fill="white"
        stroke={selected ? '#2563eb' : '#dbe5f1'}
        strokeWidth={selected ? 2.8 : 1.6}
      />

      {/* Selected glow frame */}
      {selected && (
        <rect x={-1.5} y={-1.5} width={CARD_W + 3} height={CARD_H + 3} rx={22}
          fill="none" stroke={member.color + '80'} strokeWidth={1.5} />
      )}

      {/* Subtle inner frame */}
      <rect x={8} y={8} width={CARD_W - 16} height={CARD_H - 16} rx={16}
        fill="none" stroke={member.color + '2b'} strokeWidth={1} />

      {/* Header tint */}
      <rect x={0} y={0} width={CARD_W} height={122} rx={20} fill={member.color + '1a'} />
      <rect x={0} y={110} width={CARD_W} height={12} fill={member.color + '1a'} />

      {/* Content panel */}
      <rect x={10} y={156} width={CARD_W - 20} height={CARD_H - 166} rx={14} fill="#f8fafc" />

      {/* Left accent strip */}
      <rect x={0} y={0} width={5} height={CARD_H} rx={5} fill={member.color} />

      {/* Avatar ring */}
      <circle cx={avatarCX} cy={avatarCY} r={54} fill={member.color + '36'} />
      <circle cx={avatarCX} cy={avatarCY} r={44} fill={member.color} />

      {member.photoUrl ? (
        <>
          <clipPath id={`clip-${member.id}`}>
            <circle cx={avatarCX} cy={avatarCY} r={44} />
          </clipPath>
          <image href={member.photoUrl}
            x={avatarCX - 44} y={avatarCY - 44} width={88} height={88}
            clipPath={`url(#clip-${member.id})`}
            preserveAspectRatio="xMidYMid slice"
          />
        </>
      ) : (
        <text x={avatarCX} y={avatarCY}
          textAnchor="middle" dominantBaseline="central"
          fill="white" fontSize={18} fontWeight={800} fontFamily="Inter, sans-serif">
          {member.initials}
        </text>
      )}

      {/* Rank badge */}
      {member.rank && (
        <>
          <rect
            x={CARD_W / 2 - (member.rank.length * 7.2 + 20) / 2}
            y={130}
            width={member.rank.length * 7.2 + 20}
            height={24}
            rx={8}
            fill={member.color + '1f'}
          />
          <text x={CARD_W / 2} y={142} textAnchor="middle" dominantBaseline="central"
            fill={member.color} fontSize={12} fontWeight={800} fontFamily="Inter, sans-serif">
            {member.rank}
          </text>
        </>
      )}

      {/* Full Name */}
      <text x={CARD_W / 2} y={member.rank ? 186 : 170} textAnchor="middle"
        fill="#0f172a" fontSize={18} fontWeight={800} fontFamily="Inter, sans-serif">
        {member.name.length > 26 ? member.name.slice(0, 25) + '…' : member.name}
      </text>

      {/* Position */}
      <text x={CARD_W / 2} y={member.rank ? 214 : 198} textAnchor="middle"
        fill="#334155" fontSize={14} fontWeight={600} fontFamily="Inter, sans-serif">
        {member.position.length > 28 ? member.position.slice(0, 27) + '…' : member.position}
      </text>

      {/* Unit */}
      {member.unit && (
        <text x={CARD_W / 2} y={member.rank ? (member.contactNo ? 255 : 241) : (member.contactNo ? 239 : 225)} textAnchor="middle"
          fill="#64748b" fontSize={12} fontWeight={500} fontFamily="Inter, sans-serif">
          {member.unit.length > 30 ? member.unit.slice(0, 29) + '…' : member.unit}
        </text>
      )}

      {/* Contact number */}
      {member.contactNo && (
        <text x={CARD_W / 2} y={member.rank ? 236 : 220} textAnchor="middle"
          fill="#475569" fontSize={12} fontWeight={600} fontFamily="Inter, sans-serif">
          {member.contactNo.length > 24 ? member.contactNo.slice(0, 23) + '…' : member.contactNo}
        </text>
      )}

      {/* Root star */}
      {!member.parentId && (
        <text x={CARD_W - 14} y={16} textAnchor="middle" dominantBaseline="central"
          fill={member.color} fontSize={12} fontFamily="Inter, sans-serif">★</text>
      )}

      {/* ── Inline action bar (only when selected) ── */}
      {selected && canManage && (
        <g transform={`translate(0, ${CARD_H + 5})`}>
          {/* Container */}
          <rect x={0} y={0} width={CARD_W} height={ACTION_H} rx={10}
            fill="white" stroke="#e2e8f0" strokeWidth={1.5} />

          {/* Edit */}
          <g data-action="edit" onClick={e => { e.stopPropagation(); onEdit() }}>
            <rect x={4} y={2} width={78} height={ACTION_H - 4} rx={7} fill="#eff6ff" />
            <text x={43} y={ACTION_H / 2 - 1} textAnchor="middle" dominantBaseline="central"
              fill="#3b63b8" fontSize={11} fontWeight={700} fontFamily="Inter, sans-serif">
              ✏ Edit
            </text>
          </g>

          {/* Add Subordinate */}
          <g data-action="add" onClick={e => { e.stopPropagation(); onAddChild() }}>
            <rect x={88} y={2} width={84} height={ACTION_H - 4} rx={7} fill="#f0fdf4" />
            <text x={130} y={ACTION_H / 2 - 1} textAnchor="middle" dominantBaseline="central"
              fill="#16a34a" fontSize={11} fontWeight={700} fontFamily="Inter, sans-serif">
              ➕ Add Sub
            </text>
          </g>

          {/* Remove */}
          <g data-action="remove" onClick={e => { e.stopPropagation(); onDelete() }}>
            <rect x={178} y={2} width={78} height={ACTION_H - 4} rx={7} fill="#fef2f2" />
            <text x={217} y={ACTION_H / 2 - 1} textAnchor="middle" dominantBaseline="central"
              fill="#ef4444" fontSize={11} fontWeight={700} fontFamily="Inter, sans-serif">
              🗑 Remove
            </text>
          </g>
        </g>
      )}
    </g>
  )
}

// ── Clear-all confirmation dialog ──────────────
function ClearAllDialog({ open, onConfirm, onCancel }: {
  open: boolean; onConfirm: () => void; onCancel: () => void
}) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-[1100] bg-black/55 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed z-[1200] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[430px] max-w-[93vw] bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-up">
        {/* Red warning banner */}
        <div className="bg-red-600 px-6 py-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl flex-shrink-0">
            ⚠️
          </div>
          <div>
            <p className="text-white font-bold text-[15px] leading-tight">Clear Entire Org Chart?</p>
            <p className="text-red-100 text-sm mt-1 leading-snug">
              All <strong className="text-white">members and connections</strong> will be permanently erased.
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5">
            <p className="text-red-800 text-sm font-bold mb-1">⛔ This action cannot be undone.</p>
            <p className="text-red-700 text-xs leading-relaxed">
              All personnel cards, reporting lines, and hierarchy structure will be removed
              from local storage. You will need to rebuild the chart from scratch.
            </p>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={onCancel}>Cancel — Keep Chart</Button>
            <button
              onClick={onConfirm}
              className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold text-sm px-5 py-2 rounded-lg transition shadow shadow-red-300"
            >
              🗑 Yes, Clear Everything
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Zoom controls overlay ──────────────────────
const ZOOM_STEP = 0.15
const ZOOM_MIN  = 0.25
const ZOOM_MAX  = 2.5

function ZoomControls({ zoom, onZoom, onReset, disabled = false }: {
  zoom: number; onZoom: (d: number) => void; onReset: () => void; disabled?: boolean
}) {
  return (
    <div className="absolute bottom-4 right-4 z-20 flex items-center gap-0.5 bg-white border border-slate-200 rounded-xl shadow-md px-1.5 py-1.5">
      <button
        onClick={() => onZoom(-ZOOM_STEP)}
        disabled={disabled || zoom <= ZOOM_MIN}
        title="Zoom out"
        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition text-lg font-bold leading-none"
      >−</button>
      <button
        onClick={onReset}
        disabled={disabled}
        title="Reset zoom & pan"
        className="px-3 py-1 text-xs font-semibold text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition min-w-[52px] text-center disabled:opacity-30 disabled:cursor-not-allowed"
      >{Math.round(zoom * 100)}%</button>
      <button
        onClick={() => onZoom(+ZOOM_STEP)}
        disabled={disabled || zoom >= ZOOM_MAX}
        title="Zoom in"
        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition text-lg font-bold leading-none"
      >+</button>
    </div>
  )
}

// ── Add / Edit Modal ───────────────────────────
function MemberModal({ open, onClose, onSave, existing, members, defaultParentId }: {
  open: boolean; onClose: () => void
  onSave: (data: Omit<OrgMember, 'id'>) => void
  existing?: OrgMember | null
  members: OrgMember[]
  defaultParentId?: string
}) {
  const { toast } = useToast()
  const fileRef   = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({
    name: '', rank: '', position: '', unit: '',
    contactNo: '',
    color: COLORS[0], photoUrl: '', parentId: '',
  })
  const [preview, setPreview] = useState('')

  useEffect(() => {
    if (!open) return
    if (existing) {
      setForm({ name: existing.name, rank: existing.rank, position: existing.position,
        unit: existing.unit ?? '', contactNo: existing.contactNo ?? '', color: existing.color, photoUrl: existing.photoUrl ?? '',
        parentId: existing.parentId ?? '' })
      setPreview(existing.photoUrl ?? '')
    } else {
      setForm(f => ({ ...f, name: '', rank: '', position: '', unit: '',
        contactNo: '',
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        photoUrl: '', parentId: defaultParentId ?? '' }))
      setPreview('')
    }
  }, [open, existing, defaultParentId])

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { const url = ev.target?.result as string; setPreview(url); setForm(f => ({ ...f, photoUrl: url })) }
    reader.readAsDataURL(file)
  }

  function submit() {
    if (!form.name.trim())     { toast.error('Name is required.'); return }
    if (!form.position.trim()) { toast.error('Position is required.'); return }
    onSave({ name: form.name.trim(), rank: form.rank.trim(), position: form.position.trim(),
      unit: form.unit.trim(), contactNo: form.contactNo.trim() || undefined, color: form.color, photoUrl: form.photoUrl || undefined,
      initials: getInitials(form.name), parentId: form.parentId || undefined })
    onClose()
  }

  // Prevent cycles
  const validParents = members.filter(m => {
    if (!existing) return true
    if (m.id === existing.id) return false
    let cur: OrgMember | undefined = m
    while (cur?.parentId) {
      if (cur.parentId === existing.id) return false
      cur = members.find(x => x.id === cur!.parentId)
    }
    return true
  })

  const cls = 'w-full px-3 py-2.5 border-[1.5px] border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition'

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Edit Member' : 'Add Member'} width="max-w-md">
      <div className="p-6 space-y-4">
        {/* Photo */}
        <div className="flex flex-col items-center gap-2">
          <div onClick={() => fileRef.current?.click()}
            className="w-20 h-20 rounded-full border-4 border-dashed border-slate-300 hover:border-blue-400 cursor-pointer flex items-center justify-center overflow-hidden transition relative group"
            style={{ background: preview ? 'transparent' : form.color + '22' }}>
            {preview
              ? <img src={preview} alt="preview" className="w-full h-full object-cover rounded-full" />
              : <span className="text-xl font-bold" style={{ color: form.color }}>{form.name ? getInitials(form.name) : '📷'}</span>}
            <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
              <span className="text-white text-xs font-semibold">Change</span>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          <button onClick={() => fileRef.current?.click()} className="text-xs text-blue-600 hover:underline">
            {preview ? 'Change Photo' : 'Upload Photo'}
          </button>
          {preview && <button onClick={() => { setPreview(''); setForm(f => ({ ...f, photoUrl: '' })) }} className="text-xs text-red-500 hover:underline">Remove</button>}
        </div>

        {/* Color */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Card Color</label>
          <div className="flex gap-2 flex-wrap">
            {COLORS.map(c => (
              <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                className="w-7 h-7 rounded-full border-2 transition-transform"
                style={{ background: c, borderColor: form.color === c ? '#0f172a' : 'transparent', transform: form.color === c ? 'scale(1.25)' : 'scale(1)' }} />
            ))}
          </div>
        </div>

        {/* Reports To */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Reports To</label>
          <select className={cls} value={form.parentId} onChange={e => setForm(f => ({ ...f, parentId: e.target.value }))}>
            <option value="">— None (Root / Top-level) —</option>
            {validParents.map(m => (
              <option key={m.id} value={m.id}>{m.rank ? `${m.rank} ` : ''}{m.name} — {m.position}</option>
            ))}
          </select>
        </div>

        {/* Rank + Name */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Rank</label>
            <select className={cls} value={form.rank} onChange={e => setForm(f => ({ ...f, rank: e.target.value }))}>
              <option value="">None</option>
              {['P/Col.','P/Lt. Col.','P/Maj.','P/Capt.','P/Lt.','P/Insp.','PSMS','PMMS','PEMS','PNCOP'].map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Full Name <span className="text-red-500">*</span></label>
            <input className={cls} placeholder="e.g. Ramon Dela Cruz" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
        </div>

        {/* Position */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Position <span className="text-red-500">*</span></label>
          <input className={cls} placeholder="e.g. Provincial Director" value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} />
        </div>

        {/* Unit */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Unit / Assignment</label>
          <input className={cls} placeholder="e.g. DDNPPO HQ" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} />
        </div>

        {/* Contact Number */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Contact Number</label>
            <input
              className={cls}
              placeholder="e.g. 09171234567"
              inputMode="numeric"
              maxLength={11}
              value={form.contactNo}
              onChange={e => {
                // Strip everything except digits, then cap at 11
                const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 11)
                setForm(f => ({ ...f, contactNo: digitsOnly }))
              }}
              onKeyDown={e => {
                // Block non-digit keys (allow control keys like Backspace, Tab, arrows)
                if (e.key.length === 1 && !/\d/.test(e.key)) {
                  e.preventDefault()
                }
              }}
            />
          </div>

        <div className="flex justify-end gap-2.5 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>{existing ? '💾 Save Changes' : '➕ Add Member'}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main Page ──────────────────────────────────
export default function OrganizationPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'P1'

  const [members,    setMembers]    = useState<OrgMember[]>([])
  useRealtimeOrgMembers(setMembers)
  const [selected,   setSelected]   = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<OrgMember | null>(null)
  const [showModal,  setShowModal]  = useState(false)
  const [showClear,  setShowClear]  = useState(false)
  const [defaultParentId, setDefaultParentId] = useState<string | undefined>()
  const [isLayoutEdit, setIsLayoutEdit] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  const [pan,       setPan]     = useState({ x: 0, y: 0 })
  const [zoom,      setZoom]    = useState(1)
  const [isPanning, setPanning] = useState(false)
  const [viewport,  setViewport] = useState({ w: 0, h: 0 })
  const panStart = useRef({ mx: 0, my: 0, px: 0, py: 0 })
  const prevLayoutEditRef = useRef(isLayoutEdit)
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function hydrateMembers() {
      const localMembers = loadMembers()
      if (localMembers.length > 0) setMembers(localMembers)

      const dbMembers = await loadMembersFromSupabase()

      if (dbMembers && dbMembers.length > 0) {
        setMembers(dbMembers)
        saveMembers(dbMembers)
      } else if (dbMembers && localMembers.length > 0) {
        await syncMembersToSupabase(localMembers)
      }

      setHydrated(true)
    }

    hydrateMembers()
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveMembers(members)
    void syncMembersToSupabase(members)
  }, [members, hydrated])
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return

    const updateViewport = () => {
      setViewport({ w: el.clientWidth, h: el.clientHeight })
    }

    updateViewport()
    const ro = new ResizeObserver(updateViewport)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const displayMembers = getDisplayMembersWithAutoHierarchy(members)
  const layout = buildLayoutMap(displayMembers)

  let canvasW = 900, canvasH = 600
  if (layout.size > 0) {
    const nodes = [...layout.values()]
    canvasW = Math.max(...nodes.map(n => n.x + CARD_W / 2)) + CANVAS_PAD
    canvasH = Math.max(...nodes.map(n => n.y + CARD_H + ACTION_H + 20)) + CANVAS_PAD
  }

  const fitScaleX = viewport.w > 0 ? (viewport.w - 32) / canvasW : 1
  const fitScaleY = viewport.h > 0 ? (viewport.h - 32) / canvasH : 1
  const lockedZoom = Math.min(1, fitScaleX, fitScaleY)
  const effectiveZoom = isLayoutEdit ? zoom : Math.max(0.35, lockedZoom)
  const getCenteredPan = (scale: number) => ({
    x: (viewport.w - canvasW * scale) / 2,
    y: (viewport.h - canvasH * scale) / 2,
  })
  const centeredPan = getCenteredPan(effectiveZoom)
  const effectivePan = isLayoutEdit ? pan : centeredPan

  useEffect(() => {
    const wasLayoutEdit = prevLayoutEditRef.current
    prevLayoutEditRef.current = isLayoutEdit

    if (isLayoutEdit && !wasLayoutEdit) {
      setPan(getCenteredPan(zoom))
    }
  }, [isLayoutEdit, zoom, canvasW, canvasH, viewport.w, viewport.h])

  function onMouseDown(e: React.MouseEvent) {
    if (!isLayoutEdit) return
    if ((e.target as Element).closest('[data-action]')) return
    if (e.button !== 0) return
    setPanning(true)
    panStart.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!isPanning) return
    setPan({ x: panStart.current.px + e.clientX - panStart.current.mx,
             y: panStart.current.py + e.clientY - panStart.current.my })
  }
  function onMouseUp() { setPanning(false) }

  function handleZoom(delta: number) {
    setZoom(currentZoom => {
      const nextZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(currentZoom + delta).toFixed(2)))

      if (isLayoutEdit && viewport.w > 0 && viewport.h > 0) {
        setPan(currentPan => {
          const centerX = viewport.w / 2
          const centerY = viewport.h / 2
          const anchorX = (centerX - currentPan.x) / currentZoom
          const anchorY = (centerY - currentPan.y) / currentZoom

          return {
            x: centerX - anchorX * nextZoom,
            y: centerY - anchorY * nextZoom,
          }
        })
      }

      return nextZoom
    })
  }
  function handleResetZoom() {
    setZoom(1)
    setPan(getCenteredPan(1))
  }

  function handlePrintChart() {
    const svg = canvasRef.current?.querySelector('svg') as SVGSVGElement | null
    if (!svg) {
      toast.error('Nothing to print yet.')
      return
    }

    const popup = window.open('', '_blank', 'width=1400,height=900')
    if (!popup) {
      toast.error('Please allow popups to print the chart.')
      return
    }

    const viewBox = svg.viewBox.baseVal
    const chartWidth = viewBox?.width || svg.clientWidth || 1
    const chartHeight = viewBox?.height || svg.clientHeight || 1
    const pageWidthPx = 11 * 96 - 2 * (12 / 25.4) * 96
    const pageHeightPx = 8.5 * 96 - 2 * (12 / 25.4) * 96
    const headerHeightPx = 72
    const scale = Math.min(1, pageWidthPx / chartWidth, (pageHeightPx - headerHeightPx) / chartHeight)
    const printWidth = Math.max(1, Math.floor(chartWidth * scale))
    const printHeight = Math.max(1, Math.floor(chartHeight * scale))
    const serializedSvg = new XMLSerializer().serializeToString(svg)
    const title = document.title || 'Organizational Chart'

    popup.document.open()
    popup.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${title}</title>
          <meta charset="utf-8" />
          <style>
            @page { size: landscape; margin: 12mm; }
            html, body {
              margin: 0;
              padding: 0;
              background: #fff;
              color: #0f172a;
              font-family: Inter, Arial, sans-serif;
              width: 100%;
              height: 100%;
              overflow: hidden;
            }
            body {
              padding: 10px 12px 12px;
              box-sizing: border-box;
            }
            .print-header {
              margin-bottom: 10px;
              break-inside: avoid;
            }
            .print-title {
              margin: 0;
              font-size: 18px;
              font-weight: 800;
            }
            .print-subtitle {
              margin: 4px 0 0;
              font-size: 11px;
              color: #475569;
            }
            .print-chart {
              width: ${printWidth}px;
              height: ${printHeight}px;
              overflow: hidden;
              break-inside: avoid;
            }
            svg {
              display: block;
              width: ${printWidth}px;
              height: ${printHeight}px;
            }
          </style>
        </head>
        <body>
          <div class="print-header">
            <h1 class="print-title">${title}</h1>
            <p class="print-subtitle">Generated on ${new Date().toLocaleString()} · Scaled to fit one page</p>
          </div>
          <div class="print-chart">${serializedSvg}</div>
        </body>
      </html>
    `)
    popup.document.close()
    popup.focus()

    popup.onload = () => {
      popup.print()
      popup.onafterprint = () => popup.close()
    }
  }

  function onWheel(e: React.WheelEvent) {
    if (!isLayoutEdit) return
    e.preventDefault()
    handleZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
  }

  function openAddModal(parentId?: string) {
    if (!isSuperAdmin) {
      toast.error('Only P1 can add organization members.')
      return
    }

    setEditTarget(null); setDefaultParentId(parentId); setShowModal(true)
  }

  function handleSave(data: Omit<OrgMember, 'id'>) {
    if (!isSuperAdmin) {
      toast.error('Only P1 can update organization members.')
      return
    }

    if (editTarget) {
      setMembers(prev => prev.map(m => m.id === editTarget.id ? { ...m, ...data } : m))
      toast.success('Member updated.')
      logEditOrgMember(data.name)
    } else {
      setMembers(prev => [...prev, { ...data, id: `org-${Date.now()}` }])
      toast.success(`${data.name} added to the org chart.`)
      logAddOrgMember(data.name)
    }
    setSelected(null)
  }

  function handleDelete(id: string) {
    if (!isSuperAdmin) {
      toast.error('Only P1 can remove organization members.')
      return
    }

    const memberToDelete = members.find(m => m.id === id)
    setMembers(prev => prev.filter(m => m.id !== id).map(m => m.parentId === id ? { ...m, parentId: undefined } : m))
    setSelected(null)
    if (memberToDelete) logDeleteOrgMember(memberToDelete.name)
    toast.success('Member removed.')
  }

  function handleClearConfirmed() {
    if (!isSuperAdmin) {
      toast.error('Only P1 can clear the organization chart.')
      return
    }

    setMembers([]); setSelected(null); setShowClear(false)
    toast.success('Org chart cleared.')
  }

  const maxDepth = layout.size === 0 ? 0 : Math.max(...[...layout.values()].map(n => {
    let depth = 0; let cur = n.member
    while (cur.parentId) {
      const p = displayMembers.find(m => m.id === cur!.parentId); if (!p) break; cur = p; depth++
    }
    return depth
  }))

  return (
    <div className="flex flex-col flex-1">
      <PageHeader title="Organization Chart" />

      <div className="flex flex-col flex-1">
        {/* Toolbar */}
        <div className="flex items-center gap-2.5 px-8 py-3 bg-white border-b border-slate-200 sticky top-14 z-40 flex-wrap">
          {isSuperAdmin && (
            <Button variant="primary" size="sm" onClick={() => openAddModal()}>
              ✚ Add Member
            </Button>
          )}

        <Button variant="outline" size="sm" onClick={handlePrintChart} disabled={members.length === 0}>
          🖨 Print Chart
        </Button>

        <button
          onClick={() => {
            setIsLayoutEdit(v => {
              const next = !v
              if (!next) {
                setPanning(false)
                handleResetZoom()
              }
              return next
            })
          }}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
            isLayoutEdit
              ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
          }`}
        >
          {isLayoutEdit ? '🛠 Layout Edit: ON' : '🛠 Layout Edit: OFF'}
        </button>

        <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          {members.length > 0 && (
            <>
              <span className="font-semibold text-slate-600">{members.length} member{members.length !== 1 ? 's' : ''}</span>
              <span>·</span>
              <span>{maxDepth + 1} level{maxDepth > 0 ? 's' : ''}</span>
              <span>·</span>
              <span className="hidden sm:inline">
                {isLayoutEdit
                  ? 'Layout edit: Scroll to zoom · Drag to pan · Click card to select'
                  : 'Drag/zoom locked · Turn ON Layout Edit to move canvas'}
              </span>
              <span className="hidden sm:inline">·</span>
              {isSuperAdmin && (
                <button
                  onClick={() => setShowClear(true)}
                  className="inline-flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-semibold px-3 py-1.5 rounded-lg transition text-xs"
                >
                  🗑 Clear All
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="p-6 flex-1">
        <div
          ref={canvasRef}
          className="relative w-full bg-white border-[1.5px] border-slate-200 rounded-2xl overflow-hidden select-none h-full min-h-0"
          style={{
            backgroundImage: 'radial-gradient(circle, #e2e8f0 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            cursor: isLayoutEdit ? (isPanning ? 'grabbing' : 'grab') : 'default',
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
          onClick={() => setSelected(null)}
        >
          {/* Empty state */}
          {members.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
              <div className="text-5xl mb-4">🏛️</div>
              <p className="text-slate-500 font-semibold text-base mb-1">No members yet</p>
              <p className="text-slate-400 text-sm">
                Click <strong>+ Add Member</strong> to build your org chart.<br />
                Use <em>Reports To</em> in the form to assign hierarchy.
              </p>
            </div>
          )}

          {/* SVG */}
          {members.length > 0 && (
            <div style={{ position: 'absolute', inset: 0, transform: `translate(${effectivePan.x}px, ${effectivePan.y}px) scale(${effectiveZoom})`, transformOrigin: '0 0', willChange: 'transform', overflow: 'visible' }}>
              <svg width={canvasW} height={canvasH} viewBox={`0 0 ${canvasW} ${canvasH}`} style={{ display: 'block' }}>
                <Lines layout={layout} />
                {[...layout.values()].map(node => (
                  <MemberCard
                    key={node.member.id}
                    node={node}
                    selected={selected === node.member.id}
                    canManage={isSuperAdmin}
                    onClick={() => setSelected(s => s === node.member.id ? null : node.member.id)}
                    onEdit={() => { setEditTarget(node.member); setDefaultParentId(node.member.parentId); setShowModal(true) }}
                    onDelete={() => handleDelete(node.member.id)}
                    onAddChild={() => openAddModal(node.member.id)}
                  />
                ))}
              </svg>
            </div>
          )}

          <ZoomControls zoom={zoom} onZoom={handleZoom} onReset={handleResetZoom} disabled={!isLayoutEdit} />
        </div>

        {/* Legend */}
        {members.length > 0 && (
          <div className="flex items-center gap-4 mt-3 text-xs text-slate-400 px-1">
            <span className="flex items-center gap-2">
              <svg width="28" height="14">
                <line x1="4"  y1="7" x2="14" y2="7" stroke="#94a3b8" strokeWidth="1.5" />
                <line x1="14" y1="7" x2="14" y2="2" stroke="#94a3b8" strokeWidth="1.5" />
                <line x1="14" y1="2" x2="24" y2="2" stroke="#94a3b8" strokeWidth="1.5" />
              </svg>
              Reporting line
            </span>
            <span>·</span>
            <span>★ = Root member</span>
            <span>·</span>
            <span>{isLayoutEdit ? 'Layout Edit ON: drag canvas and zoom enabled' : 'Layout Edit OFF: canvas drag/zoom locked'}</span>
            <span>·</span>
            <span>Click card → use <strong>Edit</strong> · <strong>Add Sub</strong> · <strong>Remove</strong> buttons below it</span>
          </div>
        )}
      </div>
    </div>

    {isSuperAdmin && (
      <ClearAllDialog open={showClear} onConfirm={handleClearConfirmed} onCancel={() => setShowClear(false)} />
    )}
    {isSuperAdmin && (
      <MemberModal open={showModal} onClose={() => { setShowModal(false); setEditTarget(null) }}
        onSave={handleSave} existing={editTarget} members={members} defaultParentId={defaultParentId} />
    )}
  </div>
  )
}