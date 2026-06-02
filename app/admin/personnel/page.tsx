'use client'
// app/admin/personnel/page.tsx

import { useState, useMemo, useEffect, useRef } from 'react'
import { PageHeader }   from '@/components/ui/PageHeader'
import { Badge }        from '@/components/ui/Badge'
import { Button }       from '@/components/ui/Button'
import { Avatar }       from '@/components/ui/Avatar'
import { SearchInput }  from '@/components/ui/SearchInput'
import { EmptyState }   from '@/components/ui/EmptyState'
import { Modal }        from '@/components/ui/Modal'
import { useToast }     from '@/components/ui/Toast'
import { FileText, Paperclip, Trash2 } from 'lucide-react'
import { useSearch, useModal, useDisclosure } from '@/hooks'
import { useRealtimeTable } from '@/hooks/useRealtimeTable'
import {
  createPersonnel201,
  archiveExpiredPersonnel201Records,
  updateDoc201Status,
  uploadDoc201File,
  CATEGORY_LABELS,
} from '@/lib/data201'
import { useAuth } from '@/lib/auth'
import { logUpdatePersonnel, logCreatePersonnel, logUploadDocument } from '@/lib/adminLogger'
import { supabase } from '@/lib/supabase'
import { status201BadgeClass, status201Icon, formatDate } from '@/lib/utils'
import type { Personnel201, Doc201Item, Doc201Status, Doc201Category } from '@/types'
import { addPersonnelSchema, editPersonnelSchema } from '@/lib/validations/personnel201'
import type { AddPersonnelFormData, EditPersonnelFormData } from '@/lib/validations/personnel201'

// ── Status Constants ──────────────────────────

export type PersonnelStatus =
  | 'In Service'
  | 'Inactive'
  | 'Separated from Service'
  | 'Reassigned from Other Unit'

export type InactiveReason = 'Detached Service' | 'On Schooling' | 'Maternity Leave'
export type SeparatedReason = 'Resigned' | 'Dismissed' | 'Retired' | 'AWOL'

const INACTIVE_REASONS: InactiveReason[] = [
  'Detached Service',
  'On Schooling',
  'Maternity Leave',
]

const SEPARATED_REASONS: SeparatedReason[] = [
  'Resigned',
  'Dismissed',
  'Retired',
  'AWOL',
]

function getTodayISODate() {
  return new Date().toISOString().split('T')[0]
}

const ARCHIVE_AFTER_YEARS = 15

function isSeparatedAndExpired(dateOfSeparation?: string): boolean {
  if (!dateOfSeparation) return false
  const separated = new Date(dateOfSeparation)
  const threshold = new Date(separated)
  threshold.setFullYear(threshold.getFullYear() + ARCHIVE_AFTER_YEARS)
  return new Date() >= threshold
}

function yearsUntilArchive(dateOfSeparation?: string): number | null {
  if (!dateOfSeparation) return null
  const separated = new Date(dateOfSeparation)
  const threshold = new Date(separated)
  threshold.setFullYear(threshold.getFullYear() + ARCHIVE_AFTER_YEARS)
  const diff = threshold.getTime() - Date.now()
  if (diff <= 0) return 0
  return Math.ceil(diff / (1000 * 60 * 60 * 24 * 365.25))
}

function makeBlankChecklist(personnelId: string): Doc201Item[] {
  const template: Array<{ category: Doc201Category; label: string; sublabel?: string }> = [
    { category: 'PERSONAL_DATA',  label: 'Updated PDS (DPRM Form)',                         sublabel: 'With latest 2x2 ID in Type A GOA Uniform' },
    { category: 'CIVIL_DOCUMENTS',label: 'Birth Certificate',                                sublabel: 'PSA copy' },
    { category: 'CIVIL_DOCUMENTS',label: 'Marriage Contract',                                sublabel: 'PSA copy (if applicable)' },
    { category: 'CIVIL_DOCUMENTS',label: 'Birth Certificates of all Children',               sublabel: 'PSA copy' },
    { category: 'ACADEMIC',       label: 'College Diploma' },
    { category: 'ACADEMIC',       label: 'Transcript of Records and CAV',                    sublabel: 'School Records or CAV' },
    { category: 'TRAINING',       label: 'Mandatory Training Documents',                     sublabel: 'Diploma, Final Order of Merits, Declaration of Graduates' },
    { category: 'TRAINING',       label: 'Specialized Training / Seminars Attended',         sublabel: 'Certificate of Graduation/Attendance' },
    { category: 'ELIGIBILITY',    label: 'Eligibilities',                                    sublabel: 'Highest/Appropriate — attested copies' },
    { category: 'SPECIAL_ORDERS', label: 'Attested Appointment / Special Orders',            sublabel: 'Temp/Perm — attested and approved' },
    { category: 'ASSIGNMENTS',    label: 'Order of Assignment, Designation / Detail' },
    { category: 'ASSIGNMENTS',    label: 'Service Records',                                  sublabel: 'Indicate Longevity and RCA Orders' },
    { category: 'PROMOTIONS',     label: 'Promotion / Demotion Orders',                      sublabel: 'Include Absorption Order and Appointments' },
    { category: 'AWARDS',         label: 'Awards, Decorations and Commendations' },
    { category: 'FIREARMS',       label: 'Firearms Records',                                 sublabel: 'Property Accountability Receipt (P.A.R)' },
    { category: 'MEDICAL',        label: 'Latest Medical Records' },
    { category: 'CASES',          label: 'Cases / Offenses',                                 sublabel: 'All administrative and criminal cases' },
    { category: 'LEAVE',          label: 'Leave Records' },
    { category: 'PAY_RECORDS',    label: 'RCA / Longevity Pay Orders',                       sublabel: 'All pay orders' },
    { category: 'PAY_RECORDS',    label: 'Latest Per FM Previous Unit' },
    { category: 'FINANCIAL',      label: 'Statement of Assets, Liabilities & Net Worth',     sublabel: 'SALN — latest copy' },
    { category: 'TAXATION',       label: 'Individual Income Tax Return (ITR)',                sublabel: 'Latest filed ITR' },
    { category: 'TAXATION',       label: 'Photocopy of Tax Identification Card (TIN)' },
    { category: 'IDENTIFICATION', label: '1 PC Latest 2x2 ID Picture',                       sublabel: 'GOA Type A Uniform' },
  ]
  return template.map((t, i) => ({
    id:          `${personnelId}-doc-${i + 1}`,
    category:    t.category,
    label:       t.label,
    sublabel:    t.sublabel,
    status:      'MISSING' as Doc201Status,
    dateUpdated: '',
  }))
}

function completionPercent(docs: Doc201Item[]) {
  if (docs.length === 0) return 0
  return Math.round((docs.filter(d => d.status === 'COMPLETE').length / docs.length) * 100)
}
function completionColor(pct: number) {
  if (pct >= 90) return 'bg-emerald-500'
  if (pct >= 60) return 'bg-amber-400'
  return 'bg-red-500'
}

function personnelStatusBadge(status: string) {
  switch (status) {
    case 'In Service':
      return { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: '🟢' }
    case 'Inactive':
      return { bg: 'bg-slate-200',   text: 'text-slate-600',   icon: '⏸️' }
    case 'Separated from Service':
      return { bg: 'bg-red-100',     text: 'text-red-700',     icon: '🔴' }
    case 'Reassigned from Other Unit':
      return { bg: 'bg-blue-100',    text: 'text-blue-700',    icon: '🔄' }
    default:
      return { bg: 'bg-slate-100',   text: 'text-slate-500',   icon: '❓' }
  }
}

const STATUS_FILTERS: Array<{ label: string; value: Doc201Status | 'ALL' }> = [
  { label: 'All',        value: 'ALL' },
  { label: '✅ Done',    value: 'COMPLETE' },
  { label: '🔄 Update',  value: 'FOR_UPDATE' },
  { label: '⚠️ Expired', value: 'EXPIRED' },
  { label: '❌ Missing', value: 'MISSING' },
]

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// ── Shared: Status + Reason Selector ─────────
function StatusReasonSelector({
  status, inactiveReason, separatedReason, dateOfSeparation,
  onStatusChange, onInactiveReasonChange, onSeparatedReasonChange,
  onDateOfSeparationChange, disabled = false,
}: {
  status: string
  inactiveReason: string
  separatedReason: string
  dateOfSeparation: string
  onStatusChange: (v: string) => void
  onInactiveReasonChange: (v: string) => void
  onSeparatedReasonChange: (v: string) => void
  onDateOfSeparationChange: (v: string) => void
  disabled?: boolean
}) {
  const cls = 'w-full px-3 py-2.5 border-[1.5px] border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition'
  const isInactive   = status === 'Inactive'
  const isSeparated  = status === 'Separated from Service'
  const hasInactiveReason  = Boolean(inactiveReason)
  const hasSeparatedReason = Boolean(separatedReason)

  useEffect(() => {
    if (isSeparated && !dateOfSeparation) {
      onDateOfSeparationChange(getTodayISODate())
    }
  }, [isSeparated, dateOfSeparation, onDateOfSeparationChange])

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
          Status <span className="text-red-500">*</span>
        </label>
        <select className={cls} value={status} onChange={e => onStatusChange(e.target.value)} disabled={disabled}>
          <option value="">Select status…</option>
          <option value="In Service">In Service</option>
          <option value="Inactive">Inactive</option>
          <option value="Separated from Service">Separated from Service</option>
          <option value="Reassigned from Other Unit">Reassigned from Other Unit</option>
        </select>
      </div>
      {isInactive && (
        <div className={`rounded-xl p-4 space-y-2 border ${hasInactiveReason ? 'bg-slate-50 border-slate-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-base ${hasInactiveReason ? 'text-slate-400' : 'text-red-500'}`}>⏸️</span>
            <p className={`text-[12px] font-semibold ${hasInactiveReason ? 'text-slate-700' : 'text-red-800'}`}>Reason for Inactivity</p>
            <span className={`text-[10px] font-semibold ml-auto ${hasInactiveReason ? 'text-emerald-600' : 'text-red-500'}`}>
              {hasInactiveReason ? 'Selected' : 'Required'}
            </span>
          </div>
          <select
            className={`w-full px-3 py-2.5 border-[1.5px] rounded-lg text-sm bg-white transition ${hasInactiveReason ? 'border-slate-300 focus:outline-none focus:border-blue-500' : 'border-red-200 focus:outline-none focus:border-red-400'}`}
            value={inactiveReason} onChange={e => onInactiveReasonChange(e.target.value)} disabled={disabled}>
            <option value="">Select reason…</option>
            {INACTIVE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}
      {isSeparated && (
        <div className={`rounded-xl p-4 space-y-3 border ${hasSeparatedReason ? 'bg-slate-50 border-slate-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-start gap-2">
            <span className={`text-base flex-shrink-0 mt-0.5 ${hasSeparatedReason ? 'text-slate-400' : 'text-red-500'}`}>🔴</span>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <p className={`text-[12px] font-semibold leading-snug ${hasSeparatedReason ? 'text-slate-700' : 'text-red-800'}`}>Reason for Separation</p>
                <span className={`text-[10px] font-semibold ${hasSeparatedReason ? 'text-emerald-600' : 'text-red-500'}`}>
                  {hasSeparatedReason ? 'Selected' : 'Required'}
                </span>
              </div>
              <p className={`text-[11px] mt-0.5 leading-relaxed ${hasSeparatedReason ? 'text-slate-500' : 'text-red-500'}`}>
                Records separated from service are automatically archived after <strong>{ARCHIVE_AFTER_YEARS} years</strong>.
              </p>
            </div>
          </div>
          <select
            className={`w-full px-3 py-2.5 border-[1.5px] rounded-lg text-sm bg-white transition ${hasSeparatedReason ? 'border-slate-300 focus:outline-none focus:border-blue-500' : 'border-red-200 focus:outline-none focus:border-red-400'}`}
            value={separatedReason} onChange={e => onSeparatedReasonChange(e.target.value)} disabled={disabled}>
            <option value="">Select reason…</option>
            {SEPARATED_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <div>
            <label className={`block text-[11px] font-semibold uppercase tracking-widest mb-1.5 ${hasSeparatedReason ? 'text-slate-600' : 'text-red-700'}`}>
              Date of Separation <span className={`text-[10px] font-semibold ${hasSeparatedReason ? 'text-slate-500' : 'text-red-500'}`}>(Auto)</span>
            </label>
            <input type="text" readOnly disabled={disabled}
              className={`w-full px-3 py-2.5 border-[1.5px] rounded-lg text-sm bg-white transition disabled:opacity-50 ${hasSeparatedReason ? 'border-slate-300' : 'border-red-200'}`}
              value={dateOfSeparation || getTodayISODate()} />
            <p className={`text-[11px] mt-1 ${hasSeparatedReason ? 'text-slate-500' : 'text-red-500'}`}>Date is automatically set when status is marked as separated.</p>
          </div>
          {dateOfSeparation && (
            <div className="flex items-start gap-2 bg-white border border-red-100 rounded-lg px-3 py-2">
              <span className="text-red-400 text-sm">🗄️</span>
              <p className="text-[11px] text-red-600 leading-relaxed">
                {isSeparatedAndExpired(dateOfSeparation)
                  ? <><strong>This record will be auto-archived</strong> — the {ARCHIVE_AFTER_YEARS}-year retention period has elapsed.</>
                  : <>📅 Auto-archive scheduled in approximately <strong>{yearsUntilArchive(dateOfSeparation)} year(s)</strong>.</>
                }
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Inline File Viewer Modal ──────────────────
function ViewFileModal({ item, open, onClose }: {
  item: (Doc201Item & { fileUrl?: string }) | null
  open: boolean
  onClose: () => void
}) {
  if (!item || !(item as any).fileUrl) return null
  const fileUrl = (item as any).fileUrl as string
  const isPDF   = !!fileUrl.match(/\.pdf(\?|$)/i)
  const isImage = !!fileUrl.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i)
  const isDocx  = !!fileUrl.match(/\.docx?(\?|$)/i)
  const isXlsx  = !!fileUrl.match(/\.xlsx?(\?|$)/i)
  const fileIcon = isPDF ? '📕' : isDocx ? '📘' : isXlsx ? '📗' : isImage ? '🖼️' : '📄'

  return (
    <Modal open={open} onClose={onClose} title={`View: ${item.label}`} width="max-w-4xl">
      <div className="flex flex-col" style={{ maxHeight: '80vh' }}>
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg flex-shrink-0">{fileIcon}</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-700 truncate">{item.label}</p>
              {item.sublabel && <p className="text-[10px] text-slate-400 truncate">{item.sublabel}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
            <a href={fileUrl} download
              className="text-[11px] font-semibold px-2.5 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 hover:border-blue-300 transition flex items-center gap-1">
              ⬇ Download
            </a>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-slate-100 min-h-0">
          {isPDF ? (
            <iframe src={fileUrl} title={item.label} className="w-full border-0" style={{ height: '65vh', minHeight: 400 }} />
          ) : isImage ? (
            <div className="flex items-center justify-center p-6 min-h-[400px]">
              <img src={fileUrl} alt={item.label} className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-md border border-slate-200 bg-white" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center min-h-[300px]">
              <span className="text-5xl mb-4">{fileIcon}</span>
              <p className="text-sm font-semibold text-slate-700 mb-1">{item.label}</p>
              <p className="text-xs text-slate-400 mb-5 max-w-xs">This file type cannot be previewed inline. Download it to view the contents.</p>
              <a href={fileUrl} download className="inline-flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition">
                ⬇ Download to view
              </a>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-white flex-shrink-0">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            {item.dateUpdated && <span>Filed: {formatDate(item.dateUpdated)}</span>}
            {item.filedBy && <span>· By: {item.filedBy}</span>}
            {item.fileSize && <span>· {item.fileSize}</span>}
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Checklist Row ─────────────────────────────
function ChecklistRow({ item, index, onUpload, onView, onDelete, canManage }: {
  item: Doc201Item & { fileUrl?: string }
  index: number
  onUpload: (item: Doc201Item) => void
  onView: (item: Doc201Item & { fileUrl?: string }) => void
  onDelete: (item: Doc201Item) => void
  canManage: boolean
}) {
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/80 transition group">
      <td className="px-2 py-2 text-center">
        <span className="inline-flex items-center justify-center w-5 h-5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-full">
          {LETTERS[index]}
        </span>
      </td>
      <td className="px-2 py-2">
        <div className="font-semibold text-[11.5px] text-slate-800 leading-snug">{item.label}</div>
        {item.sublabel && <div className="text-[10px] text-slate-400 leading-tight mt-0.5">{item.sublabel}</div>}
        {item.remarks  && <div className="text-[10px] text-amber-600 mt-0.5 font-medium">⚠ {item.remarks}</div>}
      </td>
      <td className="px-2 py-2 text-[10.5px] text-slate-500">{CATEGORY_LABELS[item.category]}</td>
      <td className="px-2 py-2">
        <Badge className={status201BadgeClass(item.status)}>
          {status201Icon(item.status)} {item.status.replace('_', ' ')}
        </Badge>
      </td>
      <td className="px-2 py-2 text-[10.5px] text-slate-500 whitespace-nowrap">
        {item.dateUpdated ? formatDate(item.dateUpdated) : <span className="text-red-400">—</span>}
      </td>
      <td className="px-2 py-2 text-[10.5px] text-slate-400">{item.filedBy ?? '—'}</td>
      <td className="px-2 py-2 text-[10.5px] text-slate-400">{item.fileSize ?? '—'}</td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          {canManage && (
            <button onClick={() => onUpload(item)}
              className="inline-flex items-center gap-0.5 text-[9.5px] font-semibold px-1.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 transition">
              <Paperclip size={9} /> Upload
            </button>
          )}
          {(item as any).fileUrl && (
            <button onClick={() => onView(item)}
              className="inline-flex items-center gap-0.5 text-[9.5px] font-semibold px-1.5 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 transition">
              <FileText size={9} /> View
            </button>
          )}
          {canManage && (
            <button onClick={() => onDelete(item)}
              className="inline-flex items-center gap-0.5 text-[9.5px] font-semibold px-1.5 py-1 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100 transition">
              <Trash2 size={9} /> Del
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Personnel Card ────────────────────────────
function PersonnelCard({ person, onClick }: { person: Personnel201; onClick: () => void }) {
  const pct        = completionPercent(person.documents)
  const complete   = person.documents.filter(d => d.status === 'COMPLETE').length
  const missing    = person.documents.filter(d => d.status === 'MISSING').length
  const forUpdate  = person.documents.filter(d => d.status === 'FOR_UPDATE').length
  const expired    = person.documents.filter(d => d.status === 'EXPIRED').length
  const isSeparated = person.status === 'Separated from Service'
  const isAutoArchived = isSeparated && isSeparatedAndExpired((person as any).dateOfSeparation)
  const badge = personnelStatusBadge(person.status ?? '')

  return (
    <button onClick={onClick}
      className={`w-full text-left bg-white border-[1.5px] rounded-xl p-5 hover:shadow-md transition-all duration-200 ${
        isAutoArchived ? 'border-red-300 hover:border-red-400 opacity-75' : 'border-slate-200 hover:border-blue-400'
      }`}>
      <div className="flex items-start gap-3 mb-4">
        {person.photoUrl ? (
          <img src={person.photoUrl} alt={person.name} className="w-11 h-11 rounded-full object-cover flex-shrink-0 border-2 border-white shadow" />
        ) : (
          <Avatar initials={person.initials} color={person.avatarColor} size="lg" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-800 text-[15px] leading-tight truncate">{person.rank} {person.name}</div>
          <div className="text-xs text-slate-400 mt-0.5">{person.serialNo} · {person.unit}</div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
              {badge.icon} {person.status}
            </span>
            {person.status === 'Inactive' && (person as any).inactiveReason && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                {(person as any).inactiveReason}
              </span>
            )}
            {isSeparated && (person as any).separatedReason && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                {(person as any).separatedReason}
              </span>
            )}
            {isAutoArchived && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-200 text-red-700">🗄 Auto-Archived</span>
            )}
            {isSeparated && !isAutoArchived && (person as any).dateOfSeparation && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                🗄 Archive in {yearsUntilArchive((person as any).dateOfSeparation)}y
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Updated: {formatDate(person.lastUpdated)}</div>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded-full flex-shrink-0 ${
          pct === 100 ? 'bg-emerald-100 text-emerald-700' : pct >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
        }`}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-3">
        <div className={`h-full rounded-full transition-all ${completionColor(pct)}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">✅ {complete}</span>
        {missing   > 0 && <span className="text-[11px] font-medium text-red-700    bg-red-50    px-2 py-0.5 rounded-full">❌ {missing}</span>}
        {forUpdate > 0 && <span className="text-[11px] font-medium text-amber-700  bg-amber-50  px-2 py-0.5 rounded-full">🔄 {forUpdate}</span>}
        {expired   > 0 && <span className="text-[11px] font-medium text-orange-700 bg-orange-50 px-2 py-0.5 rounded-full">⚠️ {expired}</span>}
        <span className="text-[11px] text-slate-400 ml-auto">{person.documents.length} items</span>
      </div>
    </button>
  )
}

// ── Upload Doc Modal ──────────────────────────
function UploadDocModal({ item, personName, uploadedBy, open, onClose, onDone }: {
  item: Doc201Item | null
  personName: string
  uploadedBy: string
  open: boolean
  onClose: () => void
  onDone: (docId: string, fileUrl: string, fileSize: string) => void
}) {
  const { toast }    = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile]           = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors]       = useState<Record<string, string>>({})

  function handleFileChange(nextFile: File | null) {
    if (!nextFile) return
    setFile(nextFile)
    setErrors(prev => ({ ...prev, file: '' }))
  }

  function resetAndClose() {
    setFile(null)
    setErrors({})
    if (fileInputRef.current) fileInputRef.current.value = ''
    onClose()
  }

  async function submit() {
    if (!item) return
    if (!file) { setErrors(prev => ({ ...prev, file: 'Attachment is required.' })); return }
    setUploading(true)
    const url = await uploadDoc201File(item.id, file, uploadedBy)
    if (url) {
      const size = (file.size / 1024 / 1024).toFixed(1) + ' MB'
      toast.success(`"${item.label}" uploaded successfully.`)
      onDone(item.id, url, size)
      resetAndClose()
    } else {
      toast.error('Upload failed. Please try again.')
    }
    setUploading(false)
  }

  return (
    <Modal open={open} onClose={uploading ? () => {} : resetAndClose} title="Upload Document" width="max-w-md">
      <div className="p-6 space-y-4">
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold mb-0.5">Document</p>
          <p className="text-sm font-semibold text-slate-800">{item?.label}</p>
          <p className="text-xs text-slate-400 mt-0.5">For: {personName}</p>
        </div>
        <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" className="hidden"
          onChange={e => handleFileChange(e.target.files?.[0] ?? null)} />
        {file ? (
          <div className="flex items-center justify-between px-4 py-3 bg-blue-50 border-[1.5px] border-blue-200 rounded-xl">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl">📄</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                <p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>
            {!uploading && (
              <button onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }} className="text-slate-400 hover:text-red-500 font-bold text-sm ml-3">✕</button>
            )}
          </div>
        ) : (
          <div onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${errors.file ? 'border-red-400 bg-red-50' : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50'}`}>
            <Paperclip size={28} className="mx-auto mb-2 text-slate-400" />
            <p className="text-sm font-medium text-slate-600 mb-1">Click to browse</p>
            <p className="text-xs text-slate-400">PDF, DOCX, JPG — max 50 MB</p>
          </div>
        )}
        {errors.file && <p className="text-xs text-red-500 mt-1 font-medium">⚠ {errors.file}</p>}
        {uploading && (
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-blue-700 font-medium">Uploading to cloud storage…</p>
          </div>
        )}
        <div className="flex justify-end gap-2.5 pt-1">
          <Button variant="outline" onClick={resetAndClose} disabled={uploading}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={uploading || !file}>
            {uploading ? 'Uploading…' : '📤 Upload'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Edit Profile Modal ────────────────────────
function EditProfileModal({ person, open, onClose, onSave }: {
  person: Personnel201 | null
  open: boolean
  onClose: () => void
  onSave: (updates: Partial<Personnel201> & {
    photoUrl?: string
    inactiveReason?: string
    separatedReason?: string
    dateOfSeparation?: string
  }) => void
}) {
  const { toast }    = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving]   = useState(false)
  const [preview, setPreview] = useState<string>('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)

  const [statusVal,        setStatusVal]        = useState('')
  const [inactiveReason,   setInactiveReason]   = useState('')
  const [separatedReason,  setSeparatedReason]  = useState('')
  const [dateOfSeparation, setDateOfSeparation] = useState('')

  const [form, setForm] = useState({
    name: '', rank: '', unit: '', contactNo: '', address: '',
    tin: '', pagIbigNo: '', philHealthNo: '', firearmSerialNo: '',
  })

  useEffect(() => {
    if (person && open) {
      setForm({
        name:            person.name            ?? '',
        rank:            person.rank            ?? '',
        unit:            person.unit            ?? '',
        contactNo:       person.contactNo       ?? '',
        address:         person.address         ?? '',
        tin:             person.tin             ?? '',
        pagIbigNo:       person.pagIbigNo       ?? '',
        philHealthNo:    person.philHealthNo    ?? '',
        firearmSerialNo: person.firearmSerialNo ?? '',
      })
      setStatusVal((person as any).status ?? '')
      setInactiveReason((person as any).inactiveReason ?? '')
      setSeparatedReason((person as any).separatedReason ?? '')
      setDateOfSeparation((person as any).dateOfSeparation ?? '')
      setPreview(person.photoUrl ?? '')
      setPhotoFile(null)
    }
  }, [person, open])

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = ev => setPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  function handleStatusChange(v: string) {
    setStatusVal(v)
    if (v !== 'Inactive') setInactiveReason('')
    if (v === 'Separated from Service') {
      setDateOfSeparation(prev => prev || getTodayISODate())
    } else {
      setSeparatedReason('')
      setDateOfSeparation('')
    }
  }

  const hasRequiredStatusReason =
    statusVal !== 'Inactive' && statusVal !== 'Separated from Service'
      ? true
      : statusVal === 'Inactive' ? Boolean(inactiveReason) : Boolean(separatedReason)

  async function submit() {
    if (!form.name.trim()) { toast.error('Name is required.'); return }
    if (!statusVal) { toast.error('Please select a status.'); return }
    if (statusVal === 'Inactive' && !inactiveReason) { toast.error('Please select a reason for inactivity.'); return }
    if (statusVal === 'Separated from Service' && !separatedReason) { toast.error('Please select a reason for separation.'); return }

    setSaving(true)
    try {
      let photoUrl = person?.photoUrl ?? undefined
      if (photoFile) {
        const avatarForm = new FormData()
        avatarForm.append('file',     photoFile)
        avatarForm.append('username', person?.id ?? 'unknown')
        const avatarRes  = await fetch('/api/users/avatar', { method: 'POST', body: avatarForm })
        const avatarJson = await avatarRes.json()
        if (avatarRes.ok && avatarJson.data?.fileUrl) {
          photoUrl = avatarJson.data.fileUrl
        } else {
          console.warn('[EditProfileModal] Avatar upload failed:', avatarJson.error)
          toast.error('Photo upload failed. Profile info will still be saved.')
        }
      }
      onSave({
        name:            form.name.trim(),
        rank:            form.rank.trim(),
        unit:            form.unit.trim(),
        status:          statusVal,
        contactNo:       form.contactNo.trim(),
        address:         form.address.trim(),
        photoUrl,
        tin:             form.tin.trim()             || undefined,
        pagIbigNo:       form.pagIbigNo.trim()       || undefined,
        philHealthNo:    form.philHealthNo.trim()    || undefined,
        firearmSerialNo: form.firearmSerialNo.trim() || undefined,
        inactiveReason:   statusVal === 'Inactive'               ? inactiveReason  : undefined,
        separatedReason:  statusVal === 'Separated from Service' ? separatedReason : undefined,
        dateOfSeparation: statusVal === 'Separated from Service' ? (dateOfSeparation || getTodayISODate()) : undefined,
      })
      toast.success('Profile updated.')
      onClose()
    } catch {
      toast.error('Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  const cls = 'w-full px-3 py-2.5 border-[1.5px] border-slate-200 rounded-lg text-sm bg-slate-50 focus:outline-none focus:border-blue-500 focus:bg-white transition'

  return (
    <Modal open={open} onClose={saving ? () => {} : onClose} title="Edit Profile" width="max-w-md" height="h-[80vh]">
      <div className="p-6 space-y-4">
        <div className="flex flex-col items-center gap-2">
          <div onClick={() => !saving && fileInputRef.current?.click()}
            className="w-24 h-24 rounded-full border-4 border-dashed border-slate-300 hover:border-blue-400 cursor-pointer flex items-center justify-center overflow-hidden relative group transition">
            {preview
              ? <img src={preview} alt="preview" className="w-full h-full object-cover rounded-full" />
              : <span className="text-3xl font-bold text-slate-400">{form.name ? form.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '📷'}</span>
            }
            <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
              <span className="text-white text-xs font-semibold">Change</span>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          <button onClick={() => !saving && fileInputRef.current?.click()} className="text-xs text-blue-600 hover:underline font-medium">
            {preview ? 'Change Photo' : 'Upload Photo'}
          </button>
          {preview && <button onClick={() => { setPreview(''); setPhotoFile(null) }} className="text-xs text-red-500 hover:underline">Remove Photo</button>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Rank</label>
            <select className={cls} value={form.rank} onChange={e => setForm(f => ({ ...f, rank: e.target.value }))} disabled={saving}>
              <option value="">None</option>
              {['P/Col.','P/Lt. Col.','P/Maj.','P/Capt.','P/Lt.','P/Insp.','PSMS','PMMS','PEMS','PNCOP'].map(r => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Full Name <span className="text-red-500">*</span></label>
            <input className={cls} placeholder="e.g. Ana Santos" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} disabled={saving} />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Unit / Assignment</label>
          <input className={cls} placeholder="e.g. DNPPO HQ" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} disabled={saving} />
        </div>
        <StatusReasonSelector
          status={statusVal} inactiveReason={inactiveReason} separatedReason={separatedReason} dateOfSeparation={dateOfSeparation}
          onStatusChange={handleStatusChange} onInactiveReasonChange={setInactiveReason}
          onSeparatedReasonChange={setSeparatedReason} onDateOfSeparationChange={setDateOfSeparation} disabled={saving}
        />
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Contact No.</label>
          <input className={cls} placeholder="e.g. 09171234567" value={form.contactNo} onChange={e => setForm(f => ({ ...f, contactNo: e.target.value }))} disabled={saving} />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Address</label>
          <textarea rows={2} className={`${cls} resize-none`} placeholder="e.g. Tagum City, Davao del Norte" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} disabled={saving} />
        </div>
        <div className="border-t border-slate-200 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">ID Numbers</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">TIN</label>
              <input className={cls} placeholder="e.g. 123-456-789" value={form.tin} onChange={e => setForm(f => ({ ...f, tin: e.target.value }))} disabled={saving} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Pag-IBIG No.</label>
              <input className={cls} placeholder="e.g. 1234-5678-9012" value={form.pagIbigNo} onChange={e => setForm(f => ({ ...f, pagIbigNo: e.target.value }))} disabled={saving} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">PhilHealth No.</label>
              <input className={cls} placeholder="e.g. 12-345678901-2" value={form.philHealthNo} onChange={e => setForm(f => ({ ...f, philHealthNo: e.target.value }))} disabled={saving} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Firearm Serial No.</label>
              <input className={cls} placeholder="e.g. SER-2024-001" value={form.firearmSerialNo} onChange={e => setForm(f => ({ ...f, firearmSerialNo: e.target.value }))} disabled={saving} />
            </div>
          </div>
        </div>
        {saving && (
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-blue-700 font-medium">Saving…</p>
          </div>
        )}
        <div className="flex justify-end gap-2.5 pt-1">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={saving || !hasRequiredStatusReason}>
            {saving ? 'Saving…' : '💾 Save Changes'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── 201 Checklist Modal ───────────────────────
// Redesigned: compact header + flex-col layout — no external scroll
function Checklist201Modal({ person, onClose, onUpdate, onProfileSave, canManage }: {
  person: Personnel201 | null
  onClose: () => void
  onUpdate: (personId: string, docId: string, status: Doc201Status, fileUrl?: string, fileSize?: string) => void
  onProfileSave: (personId: string, updates: Partial<Personnel201> & {
    photoUrl?: string
    inactiveReason?: string
    separatedReason?: string
    dateOfSeparation?: string
  }) => void
  canManage: boolean
}) {
  const { user }         = useAuth()
  const { toast }        = useToast()
  const [statusFilter, setStatusFilter] = useState<Doc201Status | 'ALL'>('ALL')
  const [catFilter,    setCatFilter]    = useState('ALL')
  const [docQuery,     setDocQuery]     = useState('')
  const uploadDisc       = useDisclosure<Doc201Item>()
  const viewDisc         = useDisclosure<Doc201Item & { fileUrl?: string }>()
  const editProfileModal = useModal()

  const docs = useMemo(() => {
    if (!person) return []
    return person.documents.filter(d => {
      const okStatus = statusFilter === 'ALL' || d.status === statusFilter
      const okCat    = catFilter    === 'ALL' || d.category === catFilter
      const okSearch = !docQuery || d.label.toLowerCase().includes(docQuery.toLowerCase())
      return okStatus && okCat && okSearch
    })
  }, [person, statusFilter, catFilter, docQuery])

  if (!person) return null

  const pct        = completionPercent(person.documents)
  const complete   = person.documents.filter(d => d.status === 'COMPLETE').length
  const missing    = person.documents.filter(d => d.status === 'MISSING').length
  const forUpdate  = person.documents.filter(d => d.status === 'FOR_UPDATE').length
  const expired    = person.documents.filter(d => d.status === 'EXPIRED').length
  const isSeparated    = person.status === 'Separated from Service'
  const isAutoArchived = isSeparated && isSeparatedAndExpired((person as any).dateOfSeparation)
  const badge = personnelStatusBadge(person.status ?? '')

  function handleDelete(item: Doc201Item) {
    if (!person || !canManage) return
    if (!window.confirm(`Delete "${item.label}"? This will reset it to MISSING status.`)) return
    onUpdate(person.id, item.id, 'MISSING')
    toast.success(`"${item.label}" reset to Missing.`)
  }

  return (
    <>
      {/*
        Modal width: max-w-5xl
        Layout: flex flex-col, fixed height h-[92vh] — fills the screen, nothing overflows outside
      */}
      <Modal open={!!person} onClose={onClose} title="" width="max-w-5xl">
        <div className="flex flex-col h-[88vh]">

          {/* ── COMPACT HEADER ── */}
          <div className="flex-shrink-0 bg-[#0f1c35]">

            {/* Top strip: photo + name/unit + ids + edit button */}
            <div className="flex items-center gap-4 px-5 py-3">

              {/* Avatar — small circle */}
              <div className="flex-shrink-0">
                {person.photoUrl ? (
                  <img src={person.photoUrl} alt={person.name}
                    className="w-12 h-12 rounded-full object-cover border-2 border-white/20" />
                ) : (
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold text-white border-2 border-white/20"
                    style={{ background: person.avatarColor }}>
                    {person.initials}
                  </div>
                )}
              </div>

              {/* Name + rank + unit + status */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-bold text-[14px] leading-tight">{person.rank} {person.name}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>
                    {badge.icon} {person.status}
                  </span>
                  {person.status === 'Inactive' && (person as any).inactiveReason && (
                    <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-600 text-slate-200">
                      {(person as any).inactiveReason}
                    </span>
                  )}
                  {isSeparated && (person as any).separatedReason && (
                    <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-red-900/60 text-red-300">
                      {(person as any).separatedReason}
                    </span>
                  )}
                  {isAutoArchived && (
                    <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-red-800 text-red-200">🗄 Auto-Archived</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  <span className="text-[11px] text-white/50">{person.unit}</span>
                  <span className="text-[11px] text-white/40">#{person.serialNo}</span>
                  {person.contactNo && <span className="text-[11px] text-white/40">📞 {person.contactNo}</span>}
                  {person.address   && <span className="text-[11px] text-white/40 truncate max-w-[180px]">📍 {person.address}</span>}
                </div>
              </div>

              {/* ID numbers — compact right column */}
              <div className="hidden md:flex flex-col gap-0.5 text-right flex-shrink-0">
                {[
                  { label: 'TIN',        value: person.tin },
                  { label: 'Pag-IBIG',   value: person.pagIbigNo },
                  { label: 'PhilHealth', value: person.philHealthNo },
                  { label: 'Firearm',    value: person.firearmSerialNo },
                ].filter(r => r.value).map(r => (
                  <div key={r.label} className="flex items-center gap-1.5 justify-end">
                    <span className="text-[9px] text-white/35 uppercase tracking-wide">{r.label}:</span>
                    <span className="text-[10.5px] text-white/70 font-medium">{r.value}</span>
                  </div>
                ))}
                {isSeparated && (person as any).dateOfSeparation && (
                  <div className="flex items-center gap-1.5 justify-end">
                    <span className="text-[9px] text-white/35 uppercase tracking-wide">Separated:</span>
                    <span className="text-[10.5px] text-white/70 font-medium">{formatDate((person as any).dateOfSeparation)}</span>
                  </div>
                )}
              </div>

              {/* Edit + Close */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {canManage && (
                  <button onClick={editProfileModal.open}
                    className="text-[11px] font-semibold px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white/80 hover:text-white border border-white/20 rounded-lg transition">
                    ✏️ Edit
                  </button>
                )}
                <button onClick={onClose}
                  className="text-[11px] font-semibold px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white/60 hover:text-white border border-white/20 rounded-lg transition">
                  ✕
                </button>
              </div>
            </div>

            {/* Progress strip */}
            <div className="px-5 pb-2.5">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${completionColor(pct)}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[11px] font-bold text-white/70 whitespace-nowrap">{pct}%</span>
                <div className="flex gap-1.5">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-emerald-900/50 text-emerald-400 rounded-full">✅ {complete}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-red-900/50    text-red-400    rounded-full">❌ {missing}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-amber-900/50  text-amber-400  rounded-full">🔄 {forUpdate}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-orange-900/50 text-orange-400 rounded-full">⚠️ {expired}</span>
                </div>
              </div>
            </div>

            {/* Auto-archive warning */}
            {isAutoArchived && (
              <div className="bg-red-700 px-5 py-2 flex items-center gap-2">
                <span className="text-white text-xs">🗄️</span>
                <p className="text-[11px] text-red-100 font-medium">
                  This record has exceeded the {ARCHIVE_AFTER_YEARS}-year retention and has been <strong>automatically archived</strong>.
                </p>
              </div>
            )}
          </div>

          {/* ── FILTER BAR ── */}
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100 flex-wrap">
            <SearchInput value={docQuery} onChange={setDocQuery} placeholder="Search docs…" className="w-40" />
            <div className="flex gap-1">
              {STATUS_FILTERS.map(f => (
                <button key={f.value} onClick={() => setStatusFilter(f.value)}
                  className={`px-2 py-1 text-[10px] font-semibold rounded-md transition whitespace-nowrap ${
                    statusFilter === f.value ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:border-blue-400'
                  }`}>
                  {f.label}
                </button>
              ))}
            </div>
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
              className="ml-auto px-2 py-1 border border-slate-200 rounded-md text-[10.5px] bg-white text-slate-700 focus:outline-none">
              <option value="ALL">All Categories</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <span className="text-[10px] text-slate-400 whitespace-nowrap">{docs.length}/{person.documents.length}</span>
          </div>

          {/* ── TABLE — flex-1 = takes all remaining height, scrolls internally ── */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {docs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">No documents match your filters.</div>
            ) : (
              <table className="w-full border-collapse table-fixed">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-100 border-b border-slate-200">
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-center w-8">#</th>
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-left w-[28%]">Document</th>
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-left w-[17%]">Category</th>
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-left w-[12%]">Status</th>
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-left w-[11%]">Updated</th>
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-left w-[9%]">By</th>
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-left w-[7%]">Size</th>
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((item, idx) => (
                    <ChecklistRow
                      key={item.id}
                      item={item}
                      index={idx}
                      onUpload={d => uploadDisc.open(d)}
                      onView={d => viewDisc.open(d)}
                      onDelete={handleDelete}
                      canManage={canManage}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── FOOTER ── */}
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-white">
            <span className="text-[11px] text-slate-400">
              {docs.length} of {person.documents.length} documents · Last updated {formatDate(person.lastUpdated)}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
              <Button variant="primary" size="sm"
                onClick={() => toast.success('201 file submitted for DPRM review.')}>
                📨 Submit to DPRM
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {canManage && (
        <UploadDocModal
          item={uploadDisc.payload ?? null}
          personName={`${person.rank} ${person.name}`}
          uploadedBy={user?.role ?? 'P1'}
          open={uploadDisc.isOpen}
          onClose={uploadDisc.close}
          onDone={(docId, fileUrl, fileSize) => {
            onUpdate(person.id, docId, 'COMPLETE', fileUrl, fileSize)
            uploadDisc.close()
          }}
        />
      )}

      <ViewFileModal
        item={viewDisc.payload ?? null}
        open={viewDisc.isOpen}
        onClose={viewDisc.close}
      />

      {canManage && (
        <EditProfileModal
          person={person}
          open={editProfileModal.isOpen}
          onClose={editProfileModal.close}
          onSave={(updates) => onProfileSave(person.id, updates)}
        />
      )}
    </>
  )
}

// ── Add Personnel Modal ───────────────────────
function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="text-[11px] text-red-500 mt-1 font-medium flex items-center gap-1">
      <span>⚠</span> {message}
    </p>
  )
}

function formatTIN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 12)
  if (digits.length <= 3)  return digits
  if (digits.length <= 6)  return `${digits.slice(0,3)}-${digits.slice(3)}`
  if (digits.length <= 9)  return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`
  return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6,9)}-${digits.slice(9)}`
}

function formatPagIbig(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 12)
  if (digits.length <= 4)  return digits
  if (digits.length <= 8)  return `${digits.slice(0,4)}-${digits.slice(4)}`
  return `${digits.slice(0,4)}-${digits.slice(4,8)}-${digits.slice(8)}`
}

function formatPhilHealth(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 12)
  if (digits.length <= 2)  return digits
  if (digits.length <= 11) return `${digits.slice(0,2)}-${digits.slice(2)}`
  return `${digits.slice(0,2)}-${digits.slice(2,11)}-${digits.slice(11)}`
}

function AddPersonnelModal({ open, onClose, onAdd }: {
  open: boolean
  onClose: () => void
  onAdd: (p: Personnel201) => void
}) {
  const { user }     = useAuth()
  const { toast }    = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [loading,   setLoading]   = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [preview,   setPreview]   = useState<string>('')
  const [errors,    setErrors]    = useState<Record<string, string>>({})

  const [statusVal,        setStatusVal]        = useState('In Service')
  const [inactiveReason,   setInactiveReason]   = useState('')
  const [separatedReason,  setSeparatedReason]  = useState('')
  const [dateOfSeparation, setDateOfSeparation] = useState('')

  const [form, setForm] = useState({
    lastName: '', firstName: '', rank: '', serialNo: '', unit: '',
    contactNo: '', address: '', tin: '', pagIbigNo: '', philHealthNo: '',
    firearmSerialNo: '',
  })

  if (user?.role !== 'P1') return null

  const f = (k: string, v: string) => {
    setForm(p => ({ ...p, [k]: v }))
    if (errors[k]) setErrors(prev => { const n = { ...prev }; delete n[k]; return n })
  }

  function handleStatusChange(v: string) {
    setStatusVal(v)
    if (v !== 'Inactive') setInactiveReason('')
    if (v === 'Separated from Service') {
      setDateOfSeparation(prev => prev || getTodayISODate())
    } else {
      setSeparatedReason('')
      setDateOfSeparation('')
    }
    if (errors.status)          setErrors(p => { const n={...p}; delete n.status; return n })
    if (errors.inactiveReason)  setErrors(p => { const n={...p}; delete n.inactiveReason; return n })
    if (errors.separatedReason) setErrors(p => { const n={...p}; delete n.separatedReason; return n })
  }

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = ev => setPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  function resetAndClose() {
    setForm({ lastName:'', firstName:'', rank:'', serialNo:'', unit:'',
      contactNo:'', address:'', tin:'', pagIbigNo:'', philHealthNo:'', firearmSerialNo:'' })
    setStatusVal('In Service')
    setInactiveReason(''); setSeparatedReason(''); setDateOfSeparation('')
    setPhotoFile(null); setPreview(''); setErrors({})
    onClose()
  }

  async function submit() {
    const parseResult = addPersonnelSchema.safeParse({
      firstName: form.firstName, lastName: form.lastName, rank: form.rank,
      serialNo: form.serialNo || undefined, unit: form.unit || undefined,
      contactNo: form.contactNo || undefined, address: form.address || undefined,
      tin: form.tin || undefined, pagIbigNo: form.pagIbigNo || undefined,
      philHealthNo: form.philHealthNo || undefined,
      firearmSerialNo: form.firearmSerialNo || undefined,
      status: statusVal,
      inactiveReason: inactiveReason || undefined,
      separatedReason: separatedReason || undefined,
    })

    if (!parseResult.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of parseResult.error.issues) {
        const key = issue.path[0] as string
        if (!fieldErrors[key]) fieldErrors[key] = issue.message
      }
      setErrors(fieldErrors)
      toast.error('Please fix the highlighted fields before continuing.')
      return
    }

    if (user?.role !== 'P1') { toast.error('Only P1 can create 201 files.'); return }

    setLoading(true)
    try {
      const fullName = `${form.firstName} ${form.lastName}`
      const initials = `${form.firstName[0]}${form.lastName[0]}`.toUpperCase()
      const colors   = ['#3b63b8','#f0b429','#8b5cf6','#10b981','#ef4444','#0891b2']
      const color    = colors[Math.floor(Math.random() * colors.length)]

      let photoUrl: string | undefined
      if (photoFile) {
        const avatarForm = new FormData()
        avatarForm.append('file', photoFile)
        avatarForm.append('username', 'P1')
        const avatarRes  = await fetch('/api/users/avatar', { method: 'POST', body: avatarForm })
        const avatarJson = await avatarRes.json()
        if (avatarRes.ok && avatarJson.data?.fileUrl) {
          photoUrl = avatarJson.data.fileUrl
        } else {
          toast.error('Photo upload failed. Profile will be created without a photo.')
        }
      }

      const result = await createPersonnel201({
        name: fullName, rank: form.rank, serialNo: form.serialNo || undefined,
        unit: form.unit || undefined, initials, avatarColor: color,
        status: statusVal, photoUrl,
        contactNo: form.contactNo || undefined, address: form.address || undefined,
        tin: form.tin || undefined, pagIbigNo: form.pagIbigNo || undefined,
        philHealthNo: form.philHealthNo || undefined,
        firearmSerialNo: form.firearmSerialNo || undefined,
        ...(statusVal === 'Inactive'               ? { inactiveReason }  : {}),
        ...(statusVal === 'Separated from Service' ? {
          separatedReason,
          dateOfSeparation: dateOfSeparation || getTodayISODate(),
        } : {}),
      } as any)

      if (result) {
        const subNote = statusVal === 'Inactive' ? ` (${inactiveReason})` : statusVal === 'Separated from Service' ? ` (${separatedReason})` : ''
        toast.success(`201 file for ${form.rank} ${fullName} created — ${statusVal}${subNote}.`)
        await logCreatePersonnel(fullName)
        onAdd(result)
        resetAndClose()
      } else {
        toast.error('Failed to create 201 file. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const hasRequiredStatusReason =
    statusVal !== 'Inactive' && statusVal !== 'Separated from Service'
      ? true
      : statusVal === 'Inactive' ? Boolean(inactiveReason) : Boolean(separatedReason)

  const cls = (field?: string) =>
    `w-full px-3 py-2.5 border-[1.5px] rounded-lg text-sm bg-slate-50 focus:outline-none focus:bg-white transition ${
      field && errors[field] ? 'border-red-400 focus:border-red-500' : 'border-slate-200 focus:border-blue-500'
    }`

  return (
    <Modal open={open} onClose={loading ? () => {} : resetAndClose} title="Create New 201 File" width="max-w-lg">
      <div className="p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex flex-col items-center gap-2">
          <div onClick={() => !loading && fileInputRef.current?.click()}
            className="w-20 h-20 rounded-full border-4 border-dashed border-slate-300 hover:border-blue-400 cursor-pointer flex items-center justify-center overflow-hidden relative group transition">
            {preview ? <img src={preview} alt="preview" className="w-full h-full object-cover rounded-full" /> : <span className="text-2xl text-slate-400">📷</span>}
            <div className="absolute inset-0 bg-black/40 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
              <span className="text-white text-[10px] font-semibold">Change</span>
            </div>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          <button onClick={() => !loading && fileInputRef.current?.click()} className="text-xs text-blue-600 hover:underline font-medium">
            {preview ? 'Change Photo' : 'Upload Photo (optional)'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Last Name <span className="text-red-500">*</span></label>
            <input className={cls('lastName')} placeholder="Santos" value={form.lastName} onChange={e => f('lastName', e.target.value)} disabled={loading} />
            <FieldError message={errors.lastName} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">First Name <span className="text-red-500">*</span></label>
            <input className={cls('firstName')} placeholder="Ana" value={form.firstName} onChange={e => f('firstName', e.target.value)} disabled={loading} />
            <FieldError message={errors.firstName} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Rank <span className="text-red-500">*</span></label>
            <select className={cls('rank')} value={form.rank} onChange={e => f('rank', e.target.value)} disabled={loading}>
              <option value="">Select rank…</option>
              {['P/Col.','P/Lt. Col.','P/Maj.','P/Capt.','P/Lt.','P/Insp.','PSMS','PMMS','PEMS','PNCOP'].map(r => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <FieldError message={errors.rank} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Serial No.</label>
            <input className={cls('serialNo')} placeholder="PN-2024-00001" value={form.serialNo} onChange={e => f('serialNo', e.target.value.toUpperCase())} disabled={loading} />
            <FieldError message={errors.serialNo} />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Unit / Assignment</label>
          <input className={cls('unit')} placeholder="e.g. DNPPO HQ" value={form.unit} onChange={e => f('unit', e.target.value)} disabled={loading} />
          <FieldError message={errors.unit} />
        </div>
        <StatusReasonSelector
          status={statusVal} inactiveReason={inactiveReason} separatedReason={separatedReason} dateOfSeparation={dateOfSeparation}
          onStatusChange={handleStatusChange}
          onInactiveReasonChange={v => { setInactiveReason(v); setErrors(p => { const n={...p}; delete n.inactiveReason; return n }) }}
          onSeparatedReasonChange={v => { setSeparatedReason(v); setErrors(p => { const n={...p}; delete n.separatedReason; return n }) }}
          onDateOfSeparationChange={setDateOfSeparation} disabled={loading}
        />
        <FieldError message={errors.inactiveReason ?? errors.separatedReason} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Contact No.</label>
            <input className={cls('contactNo')} placeholder="09171234567" value={form.contactNo} onChange={e => f('contactNo', e.target.value)} disabled={loading} />
            <FieldError message={errors.contactNo} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Firearm Serial No.</label>
            <input className={cls('firearmSerialNo')} placeholder="SER-2024-001" value={form.firearmSerialNo} onChange={e => f('firearmSerialNo', e.target.value.toUpperCase())} disabled={loading} />
            <FieldError message={errors.firearmSerialNo} />
          </div>
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Address</label>
          <textarea rows={2} className={`${cls('address')} resize-none`} placeholder="e.g. Tagum City, Davao del Norte" value={form.address} onChange={e => f('address', e.target.value)} disabled={loading} />
          <FieldError message={errors.address} />
        </div>
        <div className="border-t border-slate-200 pt-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">ID Numbers</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">TIN</label>
              <input className={cls('tin')} placeholder="123-456-789" value={form.tin} onChange={e => f('tin', formatTIN(e.target.value))} maxLength={15} disabled={loading} />
              <FieldError message={errors.tin} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Pag-IBIG No.</label>
              <input className={cls('pagIbigNo')} placeholder="1234-5678-9012" value={form.pagIbigNo} onChange={e => f('pagIbigNo', formatPagIbig(e.target.value))} maxLength={14} disabled={loading} />
              <FieldError message={errors.pagIbigNo} />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">PhilHealth No.</label>
              <input className={cls('philHealthNo')} placeholder="12-345678901-2" value={form.philHealthNo} onChange={e => f('philHealthNo', formatPhilHealth(e.target.value))} maxLength={14} disabled={loading} />
              <FieldError message={errors.philHealthNo} />
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          A blank 201 checklist (24 items, A–X) based on the PNP DPRM standard form will be created automatically.
        </p>
        {loading && (
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-blue-700 font-medium">Creating 201 file…</p>
          </div>
        )}
        <div className="flex justify-end gap-2.5 pt-1">
          <Button variant="outline" onClick={resetAndClose} disabled={loading}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={loading || !hasRequiredStatusReason}>
            {loading ? 'Creating…' : '📁 Create 201 File'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────
export default function PersonnelFilesPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const isSuperAdmin = user?.role === 'P1'

  const [personnel, setPersonnel] = useState<Personnel201[]>([])
  const [loading, setLoading]     = useState(true)

  useRealtimeTable('personnel_201', {
    channelSuffix: 'page',
    onUpdate: row => {
      setPersonnel(prev => prev.map(p =>
        p.id === row.id
          ? { ...p, name: row.name, rank: row.rank, unit: row.unit, status: row.status }
          : p
      ))
    },
  })

  const viewDisc = useDisclosure<Personnel201>()
  const addModal = useModal()

  const { query, setQuery, filtered } = useSearch(
    personnel,
    ['name', 'rank', 'serialNo', 'unit'] as Array<keyof Personnel201>
  )

  useEffect(() => {
    async function loadPersonnel() {
      try {
        const { data, error } = await supabase
          .from('personnel_201')
          .select('*')
          .order('created_at', { ascending: false })

        if (error || !data || data.length === 0) {
          setPersonnel([])
          setLoading(false)
          return
        }

        const expiredArchivedIds = await archiveExpiredPersonnel201Records(data as any[])

        const withDocs = await Promise.all(
          data.map(async (p: any) => {
            const { data: docs, error: docsError } = await supabase
              .from('personnel_201_docs')
              .select('*')
              .eq('personnel_id', p.id)
              .order('created_at', { ascending: true })

            const personnelId = p.id

            let documentList: Doc201Item[]
            if (docsError || !docs || docs.length === 0) {
              documentList = makeBlankChecklist(personnelId)
              const docsToInsert = documentList.map(d => ({
                id:           d.id,
                personnel_id: personnelId,
                category:     d.category,
                label:        d.label,
                sublabel:     d.sublabel ?? null,
                status:       d.status,
                date_updated: null,
                filed_by:     null,
                file_size:    null,
                file_url:     null,
                remarks:      null,
              }))
              await supabase.from('personnel_201_docs').insert(docsToInsert)
            } else {
              documentList = docs.map((d: any) => ({
                id:          d.id,
                category:    d.category,
                label:       d.label,
                sublabel:    d.sublabel ?? undefined,
                status:      d.status,
                dateUpdated: d.date_updated ?? '',
                filedBy:     d.filed_by ?? undefined,
                fileSize:    d.file_size ?? undefined,
                fileUrl:     d.file_url ?? undefined,
                remarks:     d.remarks ?? undefined,
              }))
            }

            const dateOfSeparation = p.date_of_separation ?? undefined
            const effectiveStatus  = expiredArchivedIds.has(p.id) ? 'Archived' : p.status

            return {
              id:               p.id,
              name:             p.name,
              rank:             p.rank,
              serialNo:         p.serial_no            ?? '',
              unit:             p.unit                 ?? '',
              dateCreated:      p.date_created          ?? '',
              lastUpdated:      p.last_updated          ?? '',
              initials:         p.initials              ?? '',
              avatarColor:      p.avatar_color          ?? '#3b63b8',
              photoUrl:         p.photo_url             ?? undefined,
              address:          p.address               ?? undefined,
              contactNo:        p.contact_no            ?? undefined,
              dateOfRetirement: p.date_of_retirement    ?? undefined,
              status:           effectiveStatus         ?? 'In Service',
              inactiveReason:   p.inactive_reason       ?? undefined,
              separatedReason:  p.separated_reason      ?? undefined,
              dateOfSeparation,
              firearmSerialNo:  p.firearm_serial_no     ?? undefined,
              pagIbigNo:        p.pag_ibig_no           ?? undefined,
              philHealthNo:     p.phil_health_no        ?? undefined,
              tin:              p.tin                   ?? undefined,
              payslipAccountNo: p.payslip_account_no    ?? undefined,
              documents:        documentList,
            } as Personnel201
          })
        )

        setPersonnel(withDocs)
      } catch (err) {
        console.error('Failed to load personnel:', err)
        setPersonnel([])
      } finally {
        setLoading(false)
      }
    }

    loadPersonnel()
  }, [])

  function handleAdd(p: Personnel201) {
    if (!isSuperAdmin) { toast.error('Only P1 can create 201 files.'); return }
    setPersonnel(prev => [p, ...prev])
  }

  function handleDocUpdate(personId: string, docId: string, status: Doc201Status, fileUrl?: string, fileSize?: string) {
    if (!isSuperAdmin) { toast.error('Only P1 can upload or update 201 documents.'); return }

    const today = new Date().toISOString().split('T')[0]

    setPersonnel(prev => prev.map(p => {
      if (p.id !== personId) return p
      return {
        ...p,
        lastUpdated: today,
        documents: p.documents.map(d => {
          if (d.id !== docId) return d
          return { ...d, status, dateUpdated: today, filedBy: 'Admin',
            ...(fileUrl  ? { fileUrl }  : {}),
            ...(fileSize ? { fileSize } : {}),
          }
        }),
      }
    }))

    if (viewDisc.payload?.id === personId) {
      viewDisc.open({
        ...viewDisc.payload,
        lastUpdated: today,
        documents: viewDisc.payload.documents.map(d => {
          if (d.id !== docId) return d
          return { ...d, status, dateUpdated: today, filedBy: user?.role ?? 'P1',
            ...(fileUrl ? { fileUrl } : {}), ...(fileSize ? { fileSize } : {}) }
        }),
      })
    }

    supabase.from('personnel_201').update({ last_updated: today }).eq('id', personId)
      .then(({ error }) => { if (error) console.warn('last_updated update warning:', error.message) })

    if (fileUrl && status === 'COMPLETE') {
      const personObj = personnel.find(p => p.id === personId)
      const docItem   = personObj?.documents.find(d => d.id === docId)
      void logUploadDocument(`${docItem?.label ?? docId} (${personObj?.name ?? personId})`)
    }

    // If resetting to MISSING (delete), also clear from DB
    if (status === 'MISSING') {
      supabase.from('personnel_201_docs').update({
        status:       'MISSING',
        file_url:     null,
        file_size:    null,
        filed_by:     null,
        date_updated: null,
      }).eq('id', docId)
        .then(({ error }) => { if (error) console.warn('Doc reset warning:', error.message) })
    }
  }

  function handleProfileSave(personId: string, updates: Partial<Personnel201> & {
    photoUrl?: string
    inactiveReason?: string
    separatedReason?: string
    dateOfSeparation?: string
  }) {
    if (!isSuperAdmin) { toast.error('Only P1 can update personnel profiles.'); return }

    setPersonnel(prev => prev.map(p => p.id !== personId ? p : { ...p, ...updates }))
    logUpdatePersonnel(updates.name ?? 'personnel record')

    if (viewDisc.payload?.id === personId) {
      viewDisc.open({ ...viewDisc.payload, ...updates })
    }

    supabase.from('personnel_201').update({
      name:               updates.name,
      rank:               updates.rank,
      unit:               updates.unit,
      status:             updates.status,
      contact_no:         updates.contactNo,
      address:            updates.address,
      photo_url:          updates.photoUrl          ?? null,
      tin:                updates.tin               ?? null,
      pag_ibig_no:        updates.pagIbigNo         ?? null,
      phil_health_no:     updates.philHealthNo      ?? null,
      firearm_serial_no:  updates.firearmSerialNo   ?? null,
      inactive_reason:    updates.inactiveReason    ?? null,
      separated_reason:   updates.separatedReason   ?? null,
      date_of_separation: updates.dateOfSeparation  ?? null,
    }).eq('id', personId).then(({ error }) => {
      if (error) console.warn('Profile update warning:', error.message)
    })
  }

  const allDocs        = personnel.flatMap(p => p.documents)
  const activePersonnel = personnel.filter(p => p.status !== 'Archived')

  const statCards = [
    { icon: '👥', value: activePersonnel.length,                                     label: 'Active Records',     bg: 'bg-blue-50',    num: 'text-blue-700'    },
    { icon: '✅', value: allDocs.filter(d => d.status === 'COMPLETE').length,         label: 'Documents Complete', bg: 'bg-emerald-50', num: 'text-emerald-700' },
    { icon: '❌', value: allDocs.filter(d => d.status === 'MISSING').length,          label: 'Documents Missing',  bg: 'bg-red-50',     num: 'text-red-700'     },
    { icon: '🗄', value: personnel.filter(p => p.status === 'Archived').length,       label: 'Auto-Archived',      bg: 'bg-slate-50',   num: 'text-slate-600'   },
  ]

  return (
    <>
      <PageHeader title="201 Files" />

      <div className="p-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statCards.map(s => (
            <div key={s.label} className={`${s.bg} border border-slate-200 rounded-xl px-5 py-4 flex items-center gap-3`}>
              <span className="text-2xl">{s.icon}</span>
              <div>
                <div className={`text-2xl font-extrabold ${s.num}`}>{s.value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white border-[1.5px] border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-800">Personnel Roster</h2>
              <p className="text-xs text-slate-400 mt-0.5">PNP DPRM 201 File — Checklist in the Updating of Records</p>
            </div>
            {isSuperAdmin && (
              <Button variant="primary" size="sm" onClick={addModal.open}>+ New 201 File</Button>
            )}
          </div>

          <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50">
            <SearchInput value={query} onChange={setQuery}
              placeholder="Search by name, rank, serial no., unit…" className="max-w-sm flex-1" />
            <span className="text-xs text-slate-400 ml-auto">
              {filtered.length} of {personnel.length} personnel
            </span>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState icon="👤" title="No personnel records found"
                description={query ? `No results for "${query}"` : 'Create your first 201 file to get started.'}
                action={isSuperAdmin ? <Button variant="primary" size="sm" onClick={addModal.open}>+ New 201 File</Button> : undefined} />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map(person => (
                  <PersonnelCard key={person.id} person={person} onClick={() => viewDisc.open(person)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Checklist201Modal
        person={viewDisc.payload ?? null}
        onClose={viewDisc.close}
        onUpdate={handleDocUpdate}
        onProfileSave={handleProfileSave}
        canManage={isSuperAdmin}
      />
      {isSuperAdmin && (
        <AddPersonnelModal open={addModal.isOpen} onClose={addModal.close} onAdd={handleAdd} />
      )}
    </>
  )
}