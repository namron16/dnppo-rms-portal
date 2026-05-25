// lib/rbac.ts — Tag-Based Visibility + Approval Workflow
// Backend enforcement for all document access

import { supabase } from './supabase'
import { FULL_ACCESS_ROLES } from './permissions'
import type { AdminRole } from './auth'

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

export type DocType = 'master' | 'special_order' | 'daily_journal' | 'library' | 'classified_document'
export type ApprovalStatus = 'pending' | 'reviewed' | 'approved' | 'rejected'

export interface DocumentApproval {
  id: string
  document_id: string
  document_type: DocType
  status: ApprovalStatus
  reviewed_by?: string
  reviewed_at?: string
  review_remarks?: string
  approved_by?: string
  approved_at?: string
  rejected_by?: string
  rejected_at?: string
  rejection_reason?: string
  created_by: string
  created_at: string
}

export interface DocumentVisibility {
  id: string
  document_id: string
  document_type: DocType
  admin_id: string
  can_view: boolean
}

export interface AdminNotification {
  id: string
  admin_id: string
  message: string
  type: 'info' | 'approval_request' | 'approved' | 'rejected'
  document_id?: string
  document_type?: string
  is_read: boolean
  created_at: string
}

// ── Roles permitted to upload documents ───────────────────────────────────────
// All P1–P10 accounts plus WCPD and PPSMU may upload to any document module.
// admin, PD, DPDA, DPDO are view/review/approve roles only.
const UPLOAD_ALLOWED_ROLES: AdminRole[] = [
  'P1', 'P2', 'P3', 'P4', 'P5',
  'P6', 'P7', 'P8', 'P9', 'P10',
  'WCPD', 'PPSMU',
]

const TEMP_VIEW_ACCESS_MS = 24 * 60 * 60 * 1000

function isWithin24Hours(isoDate?: string | null): boolean {
  if (!isoDate) return true
  const ts = new Date(isoDate).getTime()
  if (Number.isNaN(ts)) return false
  return Date.now() - ts <= TEMP_VIEW_ACCESS_MS
}

async function hasActiveApprovedViewRequest(
  adminId: AdminRole,
  documentId: string,
  documentType: DocType
): Promise<boolean> {
  const { data, error } = await supabase
    .from('document_view_requests')
    .select('status, reviewed_at, updated_at')
    .eq('document_id', documentId)
    .eq('document_type', documentType)
    .eq('requester_id', adminId)
    .eq('status', 'approved')
    .order('reviewed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return false

  const approvedAt = (data as any).reviewed_at ?? (data as any).updated_at
  if (!approvedAt) return false

  return isWithin24Hours(approvedAt)
}

// ══════════════════════════════════════════════
// UPLOAD AUTHORIZATION GUARD
//
// FIX: previously only 'P1' was allowed.
//      Now all P1–P10, WCPD, and PPSMU roles may upload documents.
//      Each upload is stored in that user's own connected Google Drive
//      account and is visible only to them (plus privileged roles).
// ══════════════════════════════════════════════

/**
 * Throws if the given role is not permitted to upload documents.
 * Call this at the start of any upload handler.
 */
export function assertCanUpload(role: AdminRole): void {
  if (!UPLOAD_ALLOWED_ROLES.includes(role)) {
    throw new Error(
      `Upload denied: role '${role}' is not authorized to upload documents. ` +
      `Only P1–P10, WCPD, and PPSMU accounts may upload.`
    )
  }
}

/**
 * Returns true if the given role is permitted to upload documents.
 * Use this for conditional UI rendering (prefer assertCanUpload in handlers).
 */
export function checkCanUpload(role: AdminRole): boolean {
  return UPLOAD_ALLOWED_ROLES.includes(role)
}

// ══════════════════════════════════════════════
// Check if document is unrestricted (open to all)
// Returns true if document doesn't have access restrictions
// ══════════════════════════════════════════════
export async function isDocumentUnrestricted(
  documentId: string,
  documentType: DocType
): Promise<boolean> {
  if (documentType === 'master') {
    const { data, error } = await supabase
      .from('master_documents')
      .select('tagged_admin_access')
      .eq('id', documentId)
      .maybeSingle()

    if (error || !data) return true // If we can't find it, assume unrestricted
    
    // If tagged_admin_access is empty/null, it's unrestricted (open to all)
    const taggedRoles = parseTaggedAdminAccess(data.tagged_admin_access)
    return taggedRoles.length === 0
  }

  // For special_order, daily_journal, library - they are unrestricted by default
  if (documentType === 'special_order' || documentType === 'daily_journal' || documentType === 'library') {
    return true
  }

  // classified_document is always restricted (requires approval)
  if (documentType === 'classified_document') {
    return false
  }

  return true
}


export function parseTaggedAdminAccess(tagged: AdminRole[] | string | null | undefined): AdminRole[] {
  if (!tagged) return []
  if (Array.isArray(tagged)) return tagged.filter(s => !!s) as AdminRole[]
  return tagged
    .split(',')
    .map(s => s.trim() as AdminRole)
    .filter(s => s.length > 0)
}

export function isRoleTaggedForDocument(role: AdminRole, taggedRoles: AdminRole[] | string | null | undefined): boolean {
  if (!taggedRoles) return false
  const parsed = typeof taggedRoles === 'string' ? parseTaggedAdminAccess(taggedRoles) : taggedRoles
  return parsed.includes(role)
}



export async function setClassifiedDocumentVisibility(
  documentId: string,
  documentTitle = ''
): Promise<boolean> {
  const { error } = await supabase
    .from('document_visibility')
    .upsert({
      document_id: documentId,
      document_type: 'classified_document',
      admin_id: 'P2',
      can_view: true,
    }, { onConflict: 'document_id,document_type,admin_id' })

  if (error) {
    console.error('setClassifiedDocumentVisibility error:', error.message)
    return false
  }

  await supabase.from('visibility_audit_log').insert({
    document_id: documentId,
    document_type: 'classified_document',
    document_title: documentTitle,
    tagged_by: 'P2',
    tagged_roles: ['P2'],
    action: 'set',
  }).then(({ error: auditError }) => {
    if (auditError) console.warn('visibility_audit_log warn:', auditError.message)
  })

  return true
}

export async function getDocumentVisibility(
  documentId: string,
  documentType: DocType
): Promise<AdminRole[]> {
  const { data, error } = await supabase
    .from('document_visibility')
    .select('admin_id')
    .eq('document_id',   documentId)
    .eq('document_type', documentType)
    .eq('can_view',      true)

  if (error) return []
  return (data ?? []).map((r: any) => r.admin_id as AdminRole)
}

// ══════════════════════════════════════════════
// APPROVAL WORKFLOW
// ══════════════════════════════════════════════

export async function createApproval(
  documentId: string,
  documentType: DocType,
  documentTitle: string,
  createdBy: AdminRole = 'P1'
): Promise<DocumentApproval | null> {
  const { data, error } = await supabase
    .from('document_approvals')
    .insert({
      document_id:   documentId,
      document_type: documentType,
      status:        'pending',
      created_by:    createdBy,
    })
    .select()
    .single()

  if (error) { console.error('createApproval error:', error.message); return null }

  return data as DocumentApproval
}

export async function reviewByDPDAorDPDO(
  documentId: string,
  documentType: DocType,
  reviewerRole: 'DPDA' | 'DPDO',
  remarks?: string
): Promise<boolean> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('document_approvals')
    .update({ status: 'reviewed', reviewed_by: reviewerRole, reviewed_at: now, review_remarks: remarks ?? null })
    .eq('document_id',   documentId)
    .eq('document_type', documentType)
    .eq('status',        'pending')

  if (error) { console.error('reviewByDPDAorDPDO error:', error.message); return false }
  await createNotification('P1', `Your document has been reviewed by ${reviewerRole}.`, 'info', documentId, documentType)
  return true
}

export async function finalApproveByPD(
  documentId: string,
  documentType: DocType
): Promise<boolean> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('document_approvals')
    .update({ status: 'approved', approved_by: 'PD', approved_at: now })
    .eq('document_id',   documentId)
    .eq('document_type', documentType)

  if (error) { console.error('finalApproveByPD error:', error.message); return false }
  for (const role of ['P1', 'DPDA', 'DPDO'] as AdminRole[]) {
    await createNotification(role, `Document approved by PD.`, 'approved', documentId, documentType)
  }
  return true
}

export async function rejectDocument(
  documentId: string,
  documentType: DocType,
  rejectedBy: AdminRole,
  reason: string
): Promise<boolean> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('document_approvals')
    .update({ status: 'rejected', rejected_by: rejectedBy, rejected_at: now, rejection_reason: reason })
    .eq('document_id',   documentId)
    .eq('document_type', documentType)

  if (error) { console.error('rejectDocument error:', error.message); return false }
  await createNotification('P1', `Document rejected by ${rejectedBy}. Reason: ${reason}`, 'rejected', documentId, documentType)
  return true
}

export async function getApproval(
  documentId: string,
  documentType: DocType
): Promise<DocumentApproval | null> {
  const { data, error } = await supabase
    .from('document_approvals')
    .select('*')
    .eq('document_id',   documentId)
    .eq('document_type', documentType)
    .maybeSingle()

  if (error) return null
  return data as DocumentApproval | null
}

export async function getPendingApprovals(forRole: AdminRole): Promise<DocumentApproval[]> {
  let query = supabase.from('document_approvals').select('*')

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) return []
  return (data ?? []) as DocumentApproval[]
}

// ══════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════

export async function createNotification(
  adminId: AdminRole, message: string,
  type: AdminNotification['type'] = 'info',
  documentId?: string, documentType?: string
): Promise<void> {
  const { error } = await supabase.from('admin_notifications').insert({
    admin_id:      adminId,
    message,
    type,
    document_id:   documentId ?? null,
    document_type: documentType ?? null,
    is_read:       false,
  })
  if (error) console.warn('createNotification warn:', error.message)
}

export async function getNotifications(adminId: AdminRole): Promise<AdminNotification[]> {
  const { data, error } = await supabase
    .from('admin_notifications')
    .select('*')
    .eq('admin_id', adminId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return []
  return (data ?? []) as AdminNotification[]
}

export async function markAsRead(notificationId: string): Promise<void> {
  await supabase.from('admin_notifications').update({ is_read: true }).eq('id', notificationId)
}

export async function markAllAsRead(adminId: AdminRole): Promise<void> {
  await supabase.from('admin_notifications').update({ is_read: true }).eq('admin_id', adminId).eq('is_read', false)
}

export async function getUnreadCount(adminId: AdminRole): Promise<number> {
  const { count, error } = await supabase
    .from('admin_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('admin_id', adminId)
    .eq('is_read', false)
  if (error) return 0
  return count ?? 0
}