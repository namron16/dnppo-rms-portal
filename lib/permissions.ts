// lib/permissions.ts
// Role-based permission helpers.
//
// UPLOAD POLICY (FIX):
//   All P1–P10, WCPD, and PPSMU accounts may upload documents to any module
//   (Master Documents, Admin Orders, Daily Journals, e-Library).
//   Each upload is routed to that user's own connected Google Drive account
//   and is visible only to them (plus privileged roles: admin, DPDA, DPDO).
//
//   admin, PD, DPDA, DPDO are view/review/approve roles — they do NOT upload.

import { AdminRole } from "./auth"

export const FULL_ACCESS_ROLES: AdminRole[] = ['DPDA', 'DPDO']
export const VIEWER_ROLES: AdminRole[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']

// Roles that may upload, edit, delete, or archive documents
const DOCUMENT_WRITER_ROLES: AdminRole[] = [
  'P1', 'P2', 'P3', 'P4', 'P5',
  'P6', 'P7', 'P8', 'P9', 'P10',
  'WCPD', 'PPSMU',
]

export const ROLE_META: Record<AdminRole, { name: string; level: 'head' | 'deputy' | 'super_admin' | 'viewer' }> = {
  PD:    { name: 'Provincial Director',              level: 'head'        },
  DPDA:  { name: 'Deputy Director for Administration', level: 'deputy'    },
  DPDO:  { name: 'Deputy Director for Operations',   level: 'deputy'      },
  admin: { name: 'Super Admin',                      level: 'super_admin' },
  P1:    { name: 'Records Officer',                  level: 'viewer'      },
  P2:    { name: 'Admin Officer P2',                 level: 'viewer'      },
  P3:    { name: 'Admin Officer P3',                 level: 'viewer'      },
  P4:    { name: 'Admin Officer P4',                 level: 'viewer'      },
  P5:    { name: 'Admin Officer P5',                 level: 'viewer'      },
  P6:    { name: 'Admin Officer P6',                 level: 'viewer'      },
  P7:    { name: 'Admin Officer P7',                 level: 'viewer'      },
  P8:    { name: 'Admin Officer P8',                 level: 'viewer'      },
  P9:    { name: 'Admin Officer P9',                 level: 'viewer'      },
  P10:   { name: 'Admin Officer P10',                level: 'viewer'      },
  WCPD:  { name: 'Admin Officer WCPD',               level: 'viewer'      },
  PPSMU: { name: 'Admin Officer PPSMU',              level: 'viewer'      },
}

// ── Document write permissions ────────────────────────────────────────────────

/** True if this role may upload new documents to any module. */
export function canUploadDocuments(role: AdminRole): boolean {
  return DOCUMENT_WRITER_ROLES.includes(role)
}

/** True if this role may edit existing document metadata. */
export function canEditDocuments(role: AdminRole): boolean {
  return DOCUMENT_WRITER_ROLES.includes(role)
}

/** True if this role may permanently delete documents. */
export function canDeleteDocuments(role: AdminRole): boolean {
  return DOCUMENT_WRITER_ROLES.includes(role)
}

/** True if this role may archive documents. */
export function canArchiveDocuments(role: AdminRole): boolean {
  return DOCUMENT_WRITER_ROLES.includes(role)
}

/** True if this role may forward documents to other roles. */
export function canForwardDocuments(role: AdminRole): boolean {
  return DOCUMENT_WRITER_ROLES.includes(role)
}

// ── Specialised permissions ───────────────────────────────────────────────────

/** True if this role may review (but not final-approve) documents. */
export function canReviewDocuments(role: AdminRole): boolean {
  return ['DPDA', 'DPDO'].includes(role)
}

/**
 * True if this role has "full" (privileged) document access, meaning they
 * can see all documents regardless of who uploaded them.
 */
export function hasFullDocumentAccess(role: AdminRole): boolean {
  return FULL_ACCESS_ROLES.includes(role)
}

/** True if this role exclusively manages classified/confidential documents. */
export function canManageClassifiedDocuments(role: AdminRole): boolean {
  return role === 'P2'
}

/** True if this role may print classified documents. */
export function canPrintClassifiedDocuments(role: AdminRole): boolean {
  return role === 'P2'
}

/** True if this role may delete classified documents. */
export function canDeleteClassifiedDocuments(role: AdminRole): boolean {
  return role === 'P2'
}

/** True if this role may save forwarded inbox items into their own module. */
export function canSaveFromInbox(role: AdminRole): boolean {
  return ['P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'].includes(role)
}

/** True if this role may assign document visibility tags. */
export function canAssignVisibility(role: AdminRole): boolean {
  return role === 'P1'
}