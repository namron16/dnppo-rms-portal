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
  | 'disable_account' | 'enable_account'

// ── Module-level state — set on login via setCurrentLogger() ─────────────────
// _currentRole is still cached for convenience wrappers that pass the role
// as a description string. _currentUserId is now only a fallback; the live
// session is always preferred so auth.uid() and the inserted user_id match.
let _currentUserId: string | null = null
let _currentRole:   AdminRole | null = null

export function setCurrentLogger(role: AdminRole | null, userId?: string | null) {
  _currentRole   = role
  _currentUserId = userId ?? null
}

export function isLoggerReady(): boolean {
  return !!(_currentUserId && _currentRole)
}

// ── Client factory ────────────────────────────────────────────────────────────
// Server-side API routes (typeof window === 'undefined') use the service role
// client so auth.uid() = null doesn't trip the RLS policy.
// Browser code uses the anon client whose session cookie satisfies RLS.

function getSupabaseClient() {
  if (typeof window === 'undefined') {
    // Server-side: service role key bypasses all RLS
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error(
        'adminLogger (server): NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.'
      )
    }
    const { createClient } = require('@supabase/supabase-js')
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  // Browser-side: anon client — session cookie satisfies RLS
  const { createClient } = require('./supabase/client')
  return createClient()
}

// ── Core log writer ───────────────────────────────────────────────────────────

export async function logAction(
  action: LogActionType | string,
  description: string | Record<string, any>,
): Promise<void> {

  const supabase = getSupabaseClient()
  const descriptionValue =
    typeof description === 'string' ? description : JSON.stringify(description)

  // ── Resolve user_id and role ──────────────────────────────────────────────
  // On the browser we always pull the live session so the inserted user_id
  // equals auth.uid() — mismatches are what trigger the RLS 42501 error.
  // On the server (service role) we fall back to the cached values because
  // auth.getUser() is not meaningful with the service role key.
  let resolvedUserId: string | null = _currentUserId
  let resolvedRole:   string | null = _currentRole

  if (typeof window !== 'undefined') {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        resolvedUserId = user.id
        // If role wasn't cached yet, try to read it from user_metadata or app_metadata
        if (!resolvedRole) {
          resolvedRole =
            (user.user_metadata?.role as string | undefined) ??
            (user.app_metadata?.role  as string | undefined) ??
            _currentRole
        }
      }
    } catch {
      // getUser() failure is non-fatal — fall back to cached values
    }
  }

  if (!resolvedUserId || !resolvedRole) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        `[adminLogger] logAction("${action}") called before auth resolved — log dropped.\n` +
        'Ensure setCurrentLogger(role, userId) is called after login, or that the ' +
        'Supabase session cookie is present before triggering uploads.'
      )
    }
    return
  }

  const { error } = await supabase.from('admin_logs').insert({
    user_id:     resolvedUserId,
    role:        resolvedRole,
    action,
    description: descriptionValue,
  })

  if (error) {
    console.error(
      `[adminLogger] Failed to write log for action "${action}".\n`,
      `  Code:    ${error.code}\n`,
      `  Message: ${error.message}\n`,
      `  Hint:    ${error.hint ?? '—'}\n`,
      `  Details: ${error.details ?? '—'}`
    )
    // Never throw — a failed log must not crash the caller
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

export const logLogin  = (role: AdminRole) =>
  logAction('login',  `${role} logged in`)

export const logLogout = (role: AdminRole) =>
  logAction('logout', `${role} logged out`)

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

export const logCreatePersonnel = (personName: string) =>
  logAction('create_personnel', `Created 201 file for "${personName}"`)

export const logArchivePersonnel = (personName: string) =>
  logAction('archive_document', `Archived personnel record "${personName}"`)

export const logDisableAccount = (targetDisplayName: string) =>
  logAction('disable_account', `Disabled account for "${targetDisplayName}"`)

export const logEnableAccount = (targetDisplayName: string) =>
  logAction('enable_account', `Enabled account for "${targetDisplayName}"`)