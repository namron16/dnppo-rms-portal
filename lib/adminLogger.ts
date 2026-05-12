
import { createClient } from './supabase/client'
import type { AdminRole } from './auth'

export type LogActionType =
  | 'login' | 'logout' | 'view_document' | 'upload_document'
  | 'edit_document' | 'archive_document' | 'restore_document'
  | 'delete_document' | 'request_access' | 'approve_request'
  | 'reject_request' | 'download_document' | 'forward_document'
  | 'forward_attachment' | 'add_attachment' | 'archive_attachment'
  | 'create_journal' | 'edit_journal' | 'archive_journal'
  | 'create_personnel' | 'update_personnel' | 'upload_doc201'
  | 'create_special_order' | 'archive_special_order'
  | 'add_library_item' | 'archive_library_item'
  | 'review_document' | 'approve_document' | 'reject_document'
  | 'add_org_member' | 'edit_org_member' | 'remove_org_member'
  | 'recall_inbox_item' | 'save_inbox_item' | 'change_password'

// Module-level state — set on login via setCurrentLogger()
let _currentUserId: string | null = null    // Supabase UUID
let _currentRole:   AdminRole | null = null

export function setCurrentLogger(role: AdminRole | null, userId?: string | null) {
  _currentRole   = role
  _currentUserId = userId ?? null
}

export async function logAction(
  action: LogActionType,
  description: string,
): Promise<void> {
  if (!_currentUserId || !_currentRole) return

  const supabase = createClient()
  const { error } = await supabase.from('admin_logs').insert({
    user_id:     _currentUserId,
    role:        _currentRole,
    action,
    description,
  })

  if (error) console.warn('[adminLogger] Failed to write log:', error.message)
}

// ── Convenience wrappers (unchanged API) ──────

export const logLogin  = (role: AdminRole) =>
  logAction('login',  `${role} logged in`)

export const logLogout = (role: AdminRole) =>
  logAction('logout', `${role} logged out`)

export const logViewDocument = (docTitle: string) =>
  logAction('view_document', `Viewed document "${docTitle}"`)

export const logDownloadDocument = (docTitle: string) =>
  logAction('download_document', `Downloaded document "${docTitle}"`)

export const logUploadDocument = (docTitle: string) =>
  logAction('upload_document', `Uploaded document "${docTitle}"`)

export const logEditDocument = (docTitle: string) =>
  logAction('edit_document', `Edited document "${docTitle}"`)

export const logArchiveDocument = (docTitle: string, type = 'document') =>
  logAction('archive_document', `Archived ${type} "${docTitle}"`)

export const logRestoreDocument = (docTitle: string) =>
  logAction('restore_document', `Restored document "${docTitle}"`)

export const logDeleteDocument = (docTitle: string, type = 'document') =>
  logAction('delete_document', `Deleted ${type} "${docTitle}"`)

export const logRequestAccess = (docTitle: string) =>
  logAction('request_access', `Requested access to "${docTitle}"`)

export const logApproveRequest = (requesterId: string, docTitle: string) =>
  logAction('approve_request', `Approved access for ${requesterId} on "${docTitle}"`)

export const logRejectRequest = (requesterId: string, docTitle: string, reason?: string) =>
  logAction('reject_request',
    `Rejected access for ${requesterId} on "${docTitle}"${reason ? ` — ${reason}` : ''}`)

export const logForwardDocument = (docTitle: string, recipient: string) =>
  logAction('forward_document', `Forwarded "${docTitle}" to ${recipient}`)

export const logEditJournal = (entryTitle: string) =>
  logAction('edit_journal', `Edited journal entry "${entryTitle}"`)

export const logEditOrgMember = (memberName: string) =>
  logAction('edit_org_member', `Edited organization member "${memberName}"`)

export const logAddOrgMember = (memberName: string) =>
  logAction('add_org_member', `Added organization member "${memberName}"`)

export const logUpdatePersonnel = (personName: string) =>
  logAction('update_personnel', `Updated 201 profile for "${personName}"`)

export const logEditLibraryItem = (itemTitle: string) =>
  logAction('edit_document', `Edited library item "${itemTitle}"`)

export const logRenameAttachment = (oldName: string, newName: string) =>
  logAction('edit_document', `Renamed attachment "${oldName}" to "${newName}"`)

export const logPasswordChange = () =>
  logAction('change_password', `Changed password`)