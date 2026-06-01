// lib/validations.ts
// ─────────────────────────────────────────────
// Centralised Zod schemas for every form in the app.
// Import the schema you need; parse with safeParse()
// and map ZodError issues to a Record<string, string>.

import { z } from 'zod'

// ── Helper ─────────────────────────────────────────────────────────────────
/** Convert a ZodError into a flat { field: message } map. */
export function zodErrors(error: z.ZodError): Record<string, string> {
  return Object.fromEntries(
    error.issues.map(issue => [issue.path.join('.'), issue.message])
  )
}

// ══════════════════════════════════════════════════════════════════════════
// Auth
// ══════════════════════════════════════════════════════════════════════════

export const LoginSchema = z.object({
  email:    z.email('Please enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
})
export type LoginInput = z.infer<typeof LoginSchema>

// ══════════════════════════════════════════════════════════════════════════
// Access Request (Register page)
// ══════════════════════════════════════════════════════════════════════════

export const AccessRequestSchema = z.object({
  fullName: z
    .string()
    .min(1, 'Full name is required.')
    .min(2, 'Full name must be at least 2 characters.'),
  email: z
    .email('Please enter a valid email address.'),
  contactNo: z
    .string()
    .min(1, 'Contact number is required.')
    .regex(/^[\d\s\+\-\(\)]{7,20}$/, 'Please enter a valid contact number.'),
})
export type AccessRequestInput = z.infer<typeof AccessRequestSchema>

// ══════════════════════════════════════════════════════════════════════════
// Master Document
// ══════════════════════════════════════════════════════════════════════════

export const DocLevelEnum = z.enum(['REGIONAL', 'PROVINCIAL', 'STATION'])
export const DocTypeEnum  = z.enum(['PDF', 'DOCX', 'XLSX', 'Image'])
export const DocTagEnum   = z.enum(['COMPLIANCE', 'DIRECTIVE', 'CIRCULAR', 'MEMORANDUM'])

export const AddDocumentSchema = z.object({
  title: z.string().min(1, 'Document title is required.').max(200, 'Title must be 200 characters or less.'),
  level: DocLevelEnum,
  type:  DocTypeEnum,
  date:  z.string().min(1, 'Document date is required.'),
  tag:   DocTagEnum,
})
export type AddDocumentInput = z.infer<typeof AddDocumentSchema>

export const EditDocumentSchema = AddDocumentSchema
export type EditDocumentInput = z.infer<typeof EditDocumentSchema>

// ══════════════════════════════════════════════════════════════════════════
// Special Order
// ══════════════════════════════════════════════════════════════════════════

export const AddSpecialOrderSchema = z.object({
  reference: z
    .string()
    .min(1, 'SO reference is required.')
    .max(100, 'Reference must be 100 characters or less.'),
  subject: z
    .string()
    .min(1, 'Subject is required.')
    .max(300, 'Subject must be 300 characters or less.'),
  date:   z.string().min(1, 'Date is required.'),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
})
export type AddSpecialOrderInput = z.infer<typeof AddSpecialOrderSchema>

// ══════════════════════════════════════════════════════════════════════════
// Confidential / Classified Document
// ══════════════════════════════════════════════════════════════════════════

export const AddConfidentialDocSchema = z
  .object({
    title:           z.string().min(1, 'Document title is required.').max(200, 'Title must be 200 characters or less.'),
    classification:  z.enum(['RESTRICTED', 'CONFIDENTIAL']),
    access:          z.enum(['All w/ Password', 'Admin Only']),
    date:            z.string().min(1, 'Date is required.'),
    password:        z.string().min(6, 'Password must be at least 6 characters.'),
    confirmPassword: z.string().min(1, 'Please confirm the password.'),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path:    ['confirmPassword'],
  })
export type AddConfidentialDocInput = z.infer<typeof AddConfidentialDocSchema>

// ══════════════════════════════════════════════════════════════════════════
// Journal Entry
// ══════════════════════════════════════════════════════════════════════════

export const AddJournalEntrySchema = z.object({
  title:   z.string().min(1, 'Title is required.').max(200, 'Title must be 200 characters or less.'),
  type:    z.enum(['MEMO', 'REPORT', 'LOG']),
  author:  z.string().min(1, 'Author is required.').max(100, 'Author must be 100 characters or less.'),
  date:    z.string().min(1, 'Date is required.'),
  content: z.string().max(5000, 'Content must be 5000 characters or less.').optional(),
})
export type AddJournalEntryInput = z.infer<typeof AddJournalEntrySchema>

// ══════════════════════════════════════════════════════════════════════════
// Library Item
// ══════════════════════════════════════════════════════════════════════════

export const AddLibraryItemSchema = z.object({
  title:       z.string().min(1, 'Title is required.').max(200, 'Title must be 200 characters or less.'),
  category:    z.enum(['MANUAL', 'GUIDELINE', 'TEMPLATE']),
  description: z.string().max(1000, 'Description must be 1000 characters or less.').optional(),
})
export type AddLibraryItemInput = z.infer<typeof AddLibraryItemSchema>

// ══════════════════════════════════════════════════════════════════════════
// System User
// ══════════════════════════════════════════════════════════════════════════

export const AddUserSchema = z.object({
  firstName: z.string().min(1, 'First name is required.').max(50, 'First name must be 50 characters or less.'),
  lastName:  z.string().min(1, 'Last name is required.').max(50, 'Last name must be 50 characters or less.'),
  email: z
    .email('Please enter a valid email address.')
    .endsWith('@ddnppo.gov.ph', 'Email must use the @ddnppo.gov.ph domain.'),
  role: z.enum(['officer', 'admin']),
  rank: z.string().max(50, 'Rank must be 50 characters or less.').optional(),
  department: z.string().max(100, 'Department must be 100 characters or less.').optional(),
})
export type AddUserInput = z.infer<typeof AddUserSchema>

// ══════════════════════════════════════════════════════════════════════════
// Reject Access Request
// ══════════════════════════════════════════════════════════════════════════

export const RejectRequestSchema = z.object({
  reason: z.string().max(500, 'Reason must be 500 characters or less.').optional(),
})
export type RejectRequestInput = z.infer<typeof RejectRequestSchema>

// ══════════════════════════════════════════════════════════════════════════
// Personnel 201 – Add Personnel
// ══════════════════════════════════════════════════════════════════════════

const PNPRankEnum = z.enum([
  'P/Col.', 'P/Lt. Col.', 'P/Maj.', 'P/Capt.',
  'P/Lt.', 'P/Insp.', 'PSMS', 'PMMS', 'PEMS', 'PNCOP',
])

const PersonnelStatusEnum = z.enum(['Active', 'Inactive', 'On Leave', 'Retired', 'Transferred'])

export const AddPersonnelSchema = z
  .object({
    lastName:  z.string().min(1, 'Last name is required.').max(50, 'Last name must be 50 characters or less.'),
    firstName: z.string().min(1, 'First name is required.').max(50, 'First name must be 50 characters or less.'),
    rank:      PNPRankEnum,
    serialNo:  z.string().max(50, 'Serial No. must be 50 characters or less.').optional(),
    unit:      z.string().max(100, 'Unit must be 100 characters or less.').optional(),
    status:    PersonnelStatusEnum.default('Active'),
    archiveAfterYears: z.coerce
      .number()
      .int()
      .min(1, 'Must be at least 1 year.')
      .max(50, 'Must be 50 years or less.')
      .optional(),
  })
  .refine(
    data => data.status !== 'Retired' || (data.archiveAfterYears !== undefined && data.archiveAfterYears > 0),
    {
      message: 'Please specify the file retention period for retired personnel.',
      path:    ['archiveAfterYears'],
    }
  )
export type AddPersonnelInput = z.infer<typeof AddPersonnelSchema>

// ══════════════════════════════════════════════════════════════════════════
// Personnel 201 – Edit Profile
// ══════════════════════════════════════════════════════════════════════════

export const EditProfileSchema = z
  .object({
    name:            z.string().min(1, 'Name is required.').max(100, 'Name must be 100 characters or less.'),
    rank:            PNPRankEnum,
    unit:            z.string().max(100, 'Unit must be 100 characters or less.').optional(),
    status:          PersonnelStatusEnum.optional(),
    contactNo:       z
      .string()
      .regex(/^[\d\s\+\-\(\)]{7,20}$/, 'Please enter a valid contact number.')
      .or(z.literal(''))
      .optional(),
    address:         z.string().max(300, 'Address must be 300 characters or less.').optional(),
    tin:             z.string().max(20, 'TIN must be 20 characters or less.').optional(),
    pagIbigNo:       z.string().max(20, 'Pag-IBIG No. must be 20 characters or less.').optional(),
    philHealthNo:    z.string().max(20, 'PhilHealth No. must be 20 characters or less.').optional(),
    firearmSerialNo: z.string().max(50, 'Firearm serial No. must be 50 characters or less.').optional(),
    archiveAfterYears: z.coerce
      .number()
      .int()
      .min(1, 'Must be at least 1 year.')
      .max(50, 'Must be 50 years or less.')
      .optional(),
  })
  .refine(
    data => data.status !== 'Retired' || (data.archiveAfterYears !== undefined && data.archiveAfterYears > 0),
    {
      message: 'Please specify the file retention period for retired personnel.',
      path:    ['archiveAfterYears'],
    }
  )
export type EditProfileInput = z.infer<typeof EditProfileSchema>

// ══════════════════════════════════════════════════════════════════════════
// Org Chart – Add / Edit Member
// ══════════════════════════════════════════════════════════════════════════

export const OrgMemberSchema = z.object({
  name:     z.string().min(1, 'Name is required.').max(100, 'Name must be 100 characters or less.'),
  rank:     z.string().max(20, 'Rank must be 20 characters or less.').optional(),
  position: z.string().min(1, 'Position is required.').max(100, 'Position must be 100 characters or less.'),
  unit:     z.string().max(100, 'Unit must be 100 characters or less.').optional(),
  contactNo: z
    .string()
    .regex(/^[\d\s\+\-\(\)]{7,20}$/, 'Please enter a valid contact number.')
    .or(z.literal(''))
    .optional(),
  color:    z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex colour.'),
  parentId: z.string().optional(),
  photoUrl: z.string().url('Invalid photo URL.').or(z.literal('')).optional(),
})
export type OrgMemberInput = z.infer<typeof OrgMemberSchema>

// ══════════════════════════════════════════════════════════════════════════
// Master Doc – Forward
// ══════════════════════════════════════════════════════════════════════════

export const ForwardDocSchema = z.object({
  recipient: z.string().min(1, 'Please select a recipient.'),
  remarks:   z.string().max(1000, 'Remarks must be 1000 characters or less.').optional(),
})
export type ForwardDocInput = z.infer<typeof ForwardDocSchema>

// ══════════════════════════════════════════════════════════════════════════
// Settings – Access Control (illustrative; toggles need no schema)
// Backup settings
// ══════════════════════════════════════════════════════════════════════════

export const BackupSettingsSchema = z.object({
  frequency:         z.enum(['daily', 'weekly', 'monthly']),
  backup_time:       z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time format (HH:MM).'),
  retain_last_n:     z.coerce.number().int().min(1, 'Must retain at least 1 backup.').max(30),
  email_on_complete: z.boolean(),
  backup_email: z
    .email('Please enter a valid email address.')
    .or(z.literal(''))
    .optional(),
})
export type BackupSettingsInput = z.infer<typeof BackupSettingsSchema>

// ══════════════════════════════════════════════════════════════════════════
// Settings – Alert email
// ══════════════════════════════════════════════════════════════════════════

export const AlertEmailSchema = z.object({
  alert_emails: z
    .string()
    .refine(
      val =>
        val.trim() === '' ||
        val.split(',').every(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())),
      { message: 'One or more email addresses are invalid.' }
    )
    .optional(),
})
export type AlertEmailInput = z.infer<typeof AlertEmailSchema>