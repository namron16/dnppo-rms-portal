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
  | 'recall_inbox_item' | 'save_inbox_item' | 'change_password' | 'save_forwarded_document'

// ── Module-level state — set on login via setCurrentLogger() ─────────────────
let _currentUserId: string | null = null   // Supabase UUID
let _currentRole:   AdminRole | null = null

export function setCurrentLogger(role: AdminRole | null, userId?: string | null) {
  _currentRole   = role
  _currentUserId = userId ?? null
}

// ── FIX RISK 1: exported getter so auth.tsx can assert logger is ready ───────
export function isLoggerReady(): boolean {
  return !!(_currentUserId && _currentRole)
}

// ── Core log writer ───────────────────────────────────────────────────────────

export async function logAction(
  action: LogActionType | string,
  description: string | Record<string, any>,
): Promise<void> {

  // FIX RISK 1: warn in development when logger was never initialised.
  // In production this stays silent (same as before) but you will now
  // see an explicit message during local dev instead of silently missing logs.
  if (!_currentUserId || !_currentRole) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        `[adminLogger] logAction("${action}") called before setCurrentLogger() — log dropped.\n` +
        'Call setCurrentLogger(role, userId) immediately after auth resolves.'
      )
    }
    return
  }

  const supabase = createClient()
  const descriptionValue =
    typeof description === 'string' ? description : JSON.stringify(description)

  // FIX RISK 2: surface DB errors instead of only console.warn'ing them.
  // We still never throw (to keep callers fire-and-forget), but we:
  //   a) log the full error object so RLS failures are visible, and
  //   b) in development, throw so you catch silent audit gaps immediately.
  const { error } = await supabase.from('admin_logs').insert({
    user_id:     _currentUserId,
    role:        _currentRole,
    action,
    description: descriptionValue,
  })

  if (error) {
    // Always log the full error — includes RLS policy name, code, and hint.
    console.error(
      `[adminLogger] Failed to write log for action "${action}".\n`,
      `  Code:    ${error.code}\n`,
      `  Message: ${error.message}\n`,
      `  Hint:    ${error.hint ?? '—'}\n`,
      `  Details: ${error.details ?? '—'}`
    )

    // FIX RISK 2: In development, throw so tests / CI catch silent audit gaps.
    if (process.env.NODE_ENV === 'development') {
      throw new Error(
        `[adminLogger] DB insert failed for action "${action}": ${error.message}`
      )
    }
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────
// logLogin / logLogout accept the role explicitly so callers do not have to
// rely on _currentRole being set in time.

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

export const logAddLibraryItem = (itemTitle: string) =>
  logAction('add_library_item', `Added library item "${itemTitle}"`)

export const logRenameAttachment = (oldName: string, newName: string) =>
  logAction('edit_document', `Renamed attachment "${oldName}" to "${newName}"`)

export const logPasswordChange = () =>
  logAction('change_password', `Changed password`)

export const logSaveForwardedDocument = (docTitle: string, fromRole: string, targetTable: string) =>
  logAction('save_forwarded_document', `Saved forwarded "${docTitle}" from ${fromRole} to ${targetTable}`)

export const logForwardAttachment = (attachmentTitle: string, recipient: string) =>
  logAction('forward_attachment', `Forwarded attachment "${attachmentTitle}" to ${recipient}`)

export const logAddAttachment = (attachmentTitle: string, docTitle?: string) =>
  logAction('add_attachment', `Added attachment "${attachmentTitle}"${docTitle ? ` to "${docTitle}"` : ''}`)

export const logReviewDocument = (docTitle: string) =>
  logAction('review_document', `Reviewed document "${docTitle}"`)

export const logApproveDocument = (docTitle: string) =>
  logAction('approve_document', `Approved document "${docTitle}"`)

export const logRejectDocument = (docTitle: string) =>
  logAction('reject_document', `Rejected document "${docTitle}"`)

export const logCreateJournal = (entryTitle: string) =>
  logAction('create_journal', `Created journal entry "${entryTitle}"`)

export const logArchiveJournal = (entryTitle: string) =>
  logAction('archive_journal', `Archived journal entry "${entryTitle}"`)

export const logArchiveLibraryItem = (itemTitle: string) =>
  logAction('archive_library_item', `Archived library item "${itemTitle}"`)

export const logAddUser = (userName: string, email: string) =>
  logAction('add_org_member', `Added new user "${userName}" (${email})`)

export const logDeleteOrgMember = (memberName: string) =>
  logAction('remove_org_member', `Removed organization member "${memberName}"`)

// Personnel (201) convenience loggers
export const logCreatePersonnel = (personName: string) =>
  logAction('create_personnel', `Created 201 file for "${personName}"`)

export const logArchivePersonnel = (personName: string) =>
  logAction('archive_document', `Archived personnel record "${personName}"`)