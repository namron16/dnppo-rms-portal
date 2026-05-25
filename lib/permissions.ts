// Simplified — no more visibility tags or access requests
import { AdminRole } from "./auth"

export const FULL_ACCESS_ROLES: AdminRole[] = ['DPDA', 'DPDO']
export const VIEWER_ROLES: AdminRole[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']

export const ROLE_META: Record<AdminRole, { name: string; level: 'head' | 'deputy' | 'super_admin' | 'viewer' }> = {
  PD: { name: 'Provincial Director', level: 'head' },
  DPDA: { name: 'Deputy Director for Administration', level: 'deputy' },
  DPDO: { name: 'Deputy Director for Operations', level: 'deputy' },
  admin: { name: 'Super Admin', level: 'super_admin' },
  P1: { name: 'Records Officer', level: 'viewer' },
  P2: { name: 'Admin Officer P2', level: 'viewer' },
  P3: { name: 'Admin Officer P3', level: 'viewer' },
  P4: { name: 'Admin Officer P4', level: 'viewer' },
  P5: { name: 'Admin Officer P5', level: 'viewer' },
  P6: { name: 'Admin Officer P6', level: 'viewer' },
  P7: { name: 'Admin Officer P7', level: 'viewer' },
  P8: { name: 'Admin Officer P8', level: 'viewer' },
  P9: { name: 'Admin Officer P9', level: 'viewer' },
  P10: { name: 'Admin Officer P10', level: 'viewer' },
  WCPD: { name: 'Admin Officer WCPD', level: 'viewer' },
  PPSMU: { name: 'Admin Officer PPSMU', level: 'viewer' },
}

export function canUploadDocuments(role: AdminRole): boolean {
  return ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'WCPD', 'PPSMU'].includes(role)
}

export function canEditDocuments(role: AdminRole): boolean {
  return ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'WCPD', 'PPSMU'].includes(role)
}

export function canDeleteDocuments(role: AdminRole): boolean {
  return ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'WCPD', 'PPSMU'].includes(role)
}

export function canArchiveDocuments(role: AdminRole): boolean {
  return ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'WCPD', 'PPSMU'].includes(role)
}

export function canForwardDocuments(role: AdminRole): boolean {
  // All non-admin roles (P1-P10) can forward documents
  return ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'WCPD', 'PPSMU'].includes(role)
}

export function canReviewDocuments(role: AdminRole): boolean {
  return ['DPDA', 'DPDO'].includes(role)
}


export function hasFullDocumentAccess(role: AdminRole): boolean {
  return FULL_ACCESS_ROLES.includes(role)
}

export function canManageClassifiedDocuments(role: AdminRole): boolean {
  return role === 'P2'  // P2 exclusively manages classified docs
}

export function canPrintClassifiedDocuments(role: AdminRole): boolean {
  return role === 'P2'
}

export function canDeleteClassifiedDocuments(role: AdminRole): boolean {
  return role === 'P2'
}

export function canSaveFromInbox(role: AdminRole): boolean {
  return ['P2','P3','P4','P5','P6','P7','P8','P9','P10'].includes(role)
}

export function canAssignVisibility(role: AdminRole): boolean {
  return role === 'P1'
}
