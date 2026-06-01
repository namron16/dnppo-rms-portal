// lib/validations/personnel201.ts
// Zod schemas for the Personnel 201 Add/Edit modal.
// All Philippine-specific formats are validated here.

import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────────
// FIELD-LEVEL SCHEMAS
// Each one is exported so EditProfileModal can reuse individual fields.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Philippine TIN — two accepted formats:
 *   • 9-digit groups:  123-456-789
 *   • 12-digit groups: 123-456-789-000  (with branch code)
 * Only digits and hyphens; hyphens are in the right positions.
 */
export const tinSchema = z
  .string()
  .optional()
  .refine(
    val => {
      if (!val || val.trim() === '') return true          // optional field
      return /^\d{3}-\d{3}-\d{3}(-\d{3})?$/.test(val.trim())
    },
    {
      message:
        'TIN must be in the format 123-456-789 or 123-456-789-000',
    }
  )

/**
 * Pag-IBIG (HDMF) MID Number — 12 digits, grouped as 1234-5678-9012.
 * The BIR issues the number; Pag-IBIG uses the same 12-digit format.
 */
export const pagIbigSchema = z
  .string()
  .optional()
  .refine(
    val => {
      if (!val || val.trim() === '') return true
      return /^\d{4}-\d{4}-\d{4}$/.test(val.trim())
    },
    {
      message: 'Pag-IBIG No. must be in the format 1234-5678-9012',
    }
  )

/**
 * PhilHealth Identification Number (PIN) — 12 digits.
 * Format: 12-345678901-2  (2 digits – 9 digits – 1 digit)
 */
export const philHealthSchema = z
  .string()
  .optional()
  .refine(
    val => {
      if (!val || val.trim() === '') return true
      return /^\d{2}-\d{9}-\d{1}$/.test(val.trim())
    },
    {
      message: 'PhilHealth No. must be in the format 12-345678901-2',
    }
  )

/**
 * Philippine mobile / landline numbers.
 * Accepted formats:
 *   • Mobile (Globe/Smart/DITO): 09171234567 or +639171234567
 *   • Landline (Metro Manila):   021234567  or (02) 1234-5678
 *   • Landline (regional):       0821234567
 * Stored stripped of formatting; displayed as-entered.
 */
export const contactNoSchema = z
  .string()
  .optional()
  .refine(
    val => {
      if (!val || val.trim() === '') return true
      // Strip spaces, dashes, parentheses for length/pattern check
      const stripped = val.replace(/[\s\-().]/g, '')
      // Mobile: 09XXXXXXXXX (11 digits) or +639XXXXXXXXX (12 digits after +)
      const mobile  = /^(09\d{9}|\+639\d{9})$/.test(stripped)
      // Landline: 02XXXXXXX (9 digits) or 0[3-8]XXXXXXXX (10 digits)
      const landline = /^0[2-8]\d{7,8}$/.test(stripped)
      return mobile || landline
    },
    {
      message:
        'Enter a valid PH mobile (09171234567) or landline (021234567)',
    }
  )

/**
 * PNP Serial / Badge Number.
 * Format observed in PNP DPRM records: PN-YYYY-NNNNN
 *   • PN   = prefix (always "PN")
 *   • YYYY = 4-digit year
 *   • NNNNN = 4–6 digit sequence
 * Example: PN-2024-00001
 */
export const serialNoSchema = z
  .string()
  .optional()
  .refine(
    val => {
      if (!val || val.trim() === '') return true
      return /^PN-\d{4}-\d{4,6}$/.test(val.trim().toUpperCase())
    },
    {
      message: 'Serial No. must follow the format PN-YYYY-NNNNN (e.g. PN-2024-00001)',
    }
  )

/**
 * PNP Firearm Serial Number.
 * PNP Property Accountability Receipt (PAR) serial numbers follow:
 *   SER-YYYY-NNN  or  plain alphanumeric up to 20 chars (older stocks).
 * We allow both:
 *   • SER-YYYY-NNN  (preferred)
 *   • Up to 20 alphanumeric characters / hyphens (legacy format)
 */
export const firearmSerialNoSchema = z
  .string()
  .optional()
  .refine(
    val => {
      if (!val || val.trim() === '') return true
      const v = val.trim()
      const preferred = /^SER-\d{4}-\d{3,6}$/i.test(v)
      const legacy    = /^[A-Z0-9\-]{1,20}$/i.test(v)
      return preferred || legacy
    },
    {
      message:
        'Firearm Serial No. must follow SER-YYYY-NNN or be up to 20 alphanumeric characters',
    }
  )

/**
 * Full name — letters, spaces, hyphens, periods, and apostrophes only.
 * Min 2 chars, max 60 chars.
 */
export const nameSchema = z
  .string()
  .min(2, 'Must be at least 2 characters')
  .max(60, 'Must be 60 characters or fewer')
  .regex(
    /^[A-Za-zÀ-ÖØ-öø-ÿ\s'\-.]+$/,
    "Only letters, spaces, hyphens, apostrophes, and periods are allowed"
  )

/**
 * PNP Rank — must be one of the known values.
 */
export const rankSchema = z.enum(
  ['P/Col.', 'P/Lt. Col.', 'P/Maj.', 'P/Capt.', 'P/Lt.', 'P/Insp.', 'PSMS', 'PMMS', 'PEMS', 'PNCOP'] as const,
  { message: 'Please select a valid PNP rank' }
)

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE SCHEMA — used by AddPersonnelModal
// ─────────────────────────────────────────────────────────────────────────────

export const addPersonnelSchema = z.object({
  firstName:       nameSchema,
  lastName:        nameSchema,
  rank:            rankSchema,
  serialNo:        serialNoSchema,
  unit:            z.string().max(80, 'Unit name too long').optional(),
  contactNo:       contactNoSchema,
  address:         z.string().max(200, 'Address too long').optional(),
  tin:             tinSchema,
  pagIbigNo:       pagIbigSchema,
  philHealthNo:    philHealthSchema,
  firearmSerialNo: firearmSerialNoSchema,
  status: z.string().min(1, 'Please select a status'),
  // inactiveReason is required only when status === 'Inactive'
  inactiveReason: z.string().optional(),
  // separatedReason is required only when status === 'Separated from Service'
  separatedReason: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.status === 'Inactive' && !data.inactiveReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['inactiveReason'],
      message: 'Please select a reason for inactivity',
    })
  }
  if (data.status === 'Separated from Service' && !data.separatedReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['separatedReason'],
      message: 'Please select a reason for separation',
    })
  }
})

// Same schema re-used for EditProfileModal (firstName/lastName collapsed into name)
export const editPersonnelSchema = z.object({
  name:            nameSchema,
  rank:            z.string().min(1, 'Rank is required'),
  unit:            z.string().max(80, 'Unit name too long').optional(),
  contactNo:       contactNoSchema,
  address:         z.string().max(200, 'Address too long').optional(),
  tin:             tinSchema,
  pagIbigNo:       pagIbigSchema,
  philHealthNo:    philHealthSchema,
  firearmSerialNo: firearmSerialNoSchema,
  status:          z.string().min(1, 'Please select a status'),
  inactiveReason:  z.string().optional(),
  separatedReason: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.status === 'Inactive' && !data.inactiveReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['inactiveReason'],
      message: 'Please select a reason for inactivity',
    })
  }
  if (data.status === 'Separated from Service' && !data.separatedReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['separatedReason'],
      message: 'Please select a reason for separation',
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// TYPE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export type AddPersonnelFormData  = z.infer<typeof addPersonnelSchema>
export type EditPersonnelFormData = z.infer<typeof editPersonnelSchema>