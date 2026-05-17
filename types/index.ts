// types/index.ts
// ─────────────────────────────────────────────
// Shared TypeScript types used across the app.

import { AdminRole } from "@/lib/auth"

export type UserRole = 'admin' | 'officer'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  initials: string
  avatarColor: string
}

export type DocLevel = 'REGIONAL' | 'PROVINCIAL' | 'STATION'
export type DocStatus = 'ACTIVE' | 'ARCHIVED'
export type DocClassification = 'RESTRICTED' | 'CONFIDENTIAL'
export type JournalType = 'MEMO' | 'REPORT' | 'LOG'
export type LibraryCategory = 'MANUAL' | 'GUIDELINE' | 'TEMPLATE'
export type LogAction = 'Viewed' | 'Downloaded' | 'Forwarded'

export interface MasterDocument {
  id: string
  title: string
  level: DocLevel
  date: string
  type: string
  size: string
  tag: string
  created_at?: string
  children?: MasterDocument[]
}

export interface SpecialOrder {
  id: string
  reference: string
  subject: string
  date: string
  attachments: number
  status: DocStatus
  created_at?: string
}

export interface JournalEntry {
  id: string
  title: string
  type: JournalType
  author: string
  date: string
}

export interface ConfidentialDoc {
  id: string
  title: string
  classification: DocClassification
  date: string
  access: string
  created_at?: string
}

export interface LibraryItem {
  id: string
  title: string
  category: LibraryCategory
  size: string
  dateAdded: string
  created_at?: string
}

export interface ActivityLog {
  id: string
  user: string
  userInitials: string
  userColor: string
  action: LogAction
  document: string
  date: string
  time: string
  device: string
}

export interface OrgNode {
  id: string
  initials: string
  rank: string
  name: string
  title: string
  unit: string
  contactNo?: string
  color: string
  children?: OrgNode[]
}

// ── 201 / Personnel File ─────────────────────

export type Doc201Category =
  | 'PERSONAL_DATA'
  | 'CIVIL_DOCUMENTS'
  | 'ACADEMIC'
  | 'ELIGIBILITY'
  | 'ASSIGNMENTS'
  | 'SPECIAL_ORDERS'
  | 'TRAINING'
  | 'AWARDS'
  | 'PROMOTIONS'
  | 'FIREARMS'
  | 'MEDICAL'
  | 'CASES'
  | 'LEAVE'
  | 'PAY_RECORDS'
  | 'FINANCIAL'
  | 'TAXATION'
  | 'IDENTIFICATION'

export type Doc201Status = 'COMPLETE' | 'MISSING' | 'EXPIRED' | 'FOR_UPDATE'

export interface Doc201Item {
  id: string
  /** Category from the PNP DPRM checklist */
  category: Doc201Category
  /** Document label as listed in the checklist */
  label: string
  /** Optional sub-label / notes (e.g. "Longevity and RCA Orders") */
  sublabel?: string
  status: Doc201Status
  /** Date the document was filed / last updated */
  dateUpdated: string
  /** Uploader or filing officer */
  filedBy?: string
  /** File size if scanned */
  fileSize?: string
  /** Remarks or annotation */
  remarks?: string
}

export interface Personnel201 {
  id: string
  /** Officer's full name */
  name: string
  rank: string
  serialNo: string
  unit: string
  dateCreated: string
  lastUpdated: string
  initials: string
  avatarColor: string
  /** Profile photo URL */
  photoUrl?: string
  /** Extra profile fields shown in resume header */
  address?: string
  contactNo?: string
  dateOfRetirement?: string
  status?: string
  firearmSerialNo?: string
  pagIbigNo?: string
  philHealthNo?: string
  tin?: string
  payslipAccountNo?: string
  documents: Doc201Item[]

  archiveAfterYears?: number
}

// ── Inbox Items ─────────────────────────────

export type InboxStatus = 'unread' | 'read' | 'saved'

export interface InboxItem {
  id: string
  recipient_id: AdminRole
  sender_id: AdminRole
  document_type: 'master' | 'admin_order' | 'daily_journal' | 'library'
  document_id: string
  document_title: string
  document_data: Record<string, any>
  file_url?: string
  attachments: string // JSON string of AttachmentNode[]
  status: InboxStatus
  saved_to?: 'master' | 'admin_order' | 'daily_journal' | 'library'
  saved_at?: string
  forwarded_at?: string
  created_at?: string
}