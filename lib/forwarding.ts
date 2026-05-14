// lib/forwarding.ts
// FIXED:
//  1. saveAttachmentsToSpecialOrder used the OLD schema columns
//     (file_url, file_size, file_type, uploaded_by, archived) — updated to new schema.
//  2. AttachmentNode interface updated to reflect new schema shape.
//  3. saveInboxItemToPage admin_order branch still used the old attachment shape —
//     updated to call the fixed helper.

import { InboxItem } from "@/types"
import { logAction } from "./adminLogger"
import { AdminRole } from "./auth"
import { supabase } from "./supabase"

export type DocumentType = 'master_document' | 'admin_order' | 'daily_journal' | 'library'

export interface ForwardAttachmentPayload {
  originalAttachmentId?: string
  parentAttachmentId?:   string
  depth:                 number
  title:                 string
  fileName?:             string
  fileSizeBytes?:        number
  mimeType?:             string
  gdriveFileId:          string
  gdriveUrl:             string
  poolAccountId:         string
}

export interface ForwardPayload {
  recipients:      string[]
  originalDocId:   string
  documentType:    DocumentType
  title:           string
  notes?:          string
  gdriveFileId:    string
  gdriveUrl:       string
  poolAccountId:   string
  fileName?:       string
  fileSizeBytes?:  number
  mimeType?:       string
  attachments:     ForwardAttachmentPayload[]
}

export interface ForwardResult {
  success: boolean
  count:   number
  errors:  { recipient: string; error: string }[]
}

// FIX: updated to new schema — no file_url / file_size / file_type
export interface AttachmentNode {
  id:              string
  title:           string
  file_name:       string | null
  file_size_bytes: number | null
  mime_type:       string | null
  gdrive_file_id:  string
  gdrive_url:      string
  pool_account_id: string
  parent_id:       string | null
  depth:           number
  children:        AttachmentNode[]
}

/**
 * Sends the forward request to the API.
 * No GDrive upload happens here — only metadata is sent.
 */
export async function forwardDocument(payload: ForwardPayload): Promise<ForwardResult> {
  const res = await fetch('/api/forward', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  const json = await res.json()

  if (!res.ok) {
    return { success: false, count: 0, errors: [{ recipient: 'all', error: json.error ?? 'Request failed' }] }
  }

  return {
    success: json.success,
    count:   json.count,
    errors:  json.errors ?? [],
  }
}

/**
 * Flattens an attachment tree into the ForwardAttachmentPayload[] format.
 * Use this when building the payload from attachmentsMap.
 */
export function flattenAttachmentsForForward(
  docId: string,
  attachmentsMap: Map<string, any[]>
): ForwardAttachmentPayload[] {
  const flat: ForwardAttachmentPayload[] = []

  function walk(parentId: string, parentAttachmentId: string | undefined, depth: number) {
    const children = attachmentsMap.get(parentId) ?? []
    for (const att of children) {
      flat.push({
        originalAttachmentId: att.id,
        parentAttachmentId,
        depth,
        title:          att.title ?? att.file_name ?? 'Attachment',
        fileName:       att.file_name,
        fileSizeBytes:  att.file_size_bytes,
        mimeType:       att.mime_type,
        gdriveFileId:   att.gdrive_file_id,
        gdriveUrl:      att.gdrive_url,
        poolAccountId:  att.pool_account_id,
      })
      walk(att.id, att.id, depth + 1)
    }
  }

  walk(docId, undefined, 0)
  return flat
}

/**
 * Builds a nested attachment tree from a flat list.
 * Used in the inbox to reconstruct hierarchy for display.
 */
export function buildAttachmentTree(
  attachments: any[],
  parentId: string | null = null
): any[] {
  return attachments
    .filter(a => (a.parent_attachment_id ?? null) === parentId)
    .map(a => ({
      ...a,
      children: buildAttachmentTree(attachments, a.original_attachment_id ?? a.id),
    }))
}

export async function saveInboxItemToPage(
  inboxItemId: string,
  recipientId: AdminRole,
  targetPage: 'master' | 'admin_order' | 'daily_journal' | 'library'
): Promise<boolean> {
  const { data, error } = await supabase
    .from('inbox_items')
    .select('*')
    .eq('id', inboxItemId)
    .eq('recipient_id', recipientId)
    .single()

  if (error || !data) return false

  const inboxItem = data as InboxItem
  const documentData = inboxItem.document_data || {}

  try {
    switch (targetPage) {
      case 'master': {
        const masterDoc = {
          id:                  inboxItem.document_id,
          title:               documentData.title || inboxItem.document_title,
          level:               documentData.level || 'REGIONAL',
          type:                documentData.type || 'Document',
          date:                documentData.date || new Date().toISOString().split('T')[0],
          size:                documentData.size || '0 KB',
          tag:                 documentData.tag || '',
          file_url:            inboxItem.file_url || null,
          tagged_admin_access: documentData.taggedAdminAccess || null,
        }

        const { error: insertError } = await supabase
          .from('master_documents')
          .insert(masterDoc)

        if (insertError) { console.error('Error saving to master_documents:', insertError); return false }
        break
      }

      case 'admin_order': {
        const adminOrder = {
          id:          inboxItem.document_id,
          reference:   documentData.reference || inboxItem.document_title,
          subject:     documentData.subject || inboxItem.document_title,
          date:        documentData.date || new Date().toISOString().split('T')[0],
          attachments: documentData.attachments || 0,
          status:      documentData.status || 'ACTIVE',
          file_url:    inboxItem.file_url || null,
        }

        const { error: insertError } = await supabase
          .from('special_orders')
          .insert(adminOrder)

        if (insertError) { console.error('Error saving to special_orders:', insertError); return false }

        if (inboxItem.attachments && inboxItem.attachments !== '[]') {
          const attachments: AttachmentNode[] = JSON.parse(inboxItem.attachments)
          await saveAttachmentsToSpecialOrder(inboxItem.document_id, attachments)
        }
        break
      }

      case 'daily_journal': {
        const journalEntry = {
          id:          inboxItem.document_id,
          title:       documentData.title || inboxItem.document_title,
          type:        documentData.type || 'MEMO',
          author:      documentData.author || recipientId,
          date:        documentData.date || new Date().toISOString().split('T')[0],
          content:     documentData.content || null,
          summary:     documentData.summary || null,
          file_url:    inboxItem.file_url || null,
          status:      documentData.status || 'Draft',
          attachments: documentData.attachments || (inboxItem.file_url ? 1 : 0),
          archived:    false,
          saved_by:    recipientId,
        }

        const { error: insertError } = await supabase
          .from('daily_journals')
          .insert(journalEntry)

        if (insertError) { console.error('Error saving to daily_journals:', insertError); return false }
        break
      }

      case 'library': {
        const libraryItem = {
          id:          inboxItem.document_id,
          title:       documentData.title || inboxItem.document_title,
          category:    documentData.category || 'TEMPLATE',
          size:        documentData.size || '0 KB',
          date_added:  documentData.dateAdded || new Date().toISOString(),
          file_url:    inboxItem.file_url || null,
          description: documentData.description || null,
          saved_by:    recipientId,
        }

        const { error: insertError } = await supabase
          .from('library_items')
          .insert(libraryItem)

        if (insertError) { console.error('Error saving to library_items:', insertError); return false }
        break
      }

      default:
        console.error('Unknown target page:', targetPage)
        return false
    }

    const { error: updateError } = await supabase
      .from('inbox_items')
      .update({ status: 'saved', saved_to: targetPage, saved_at: new Date().toISOString() })
      .eq('id', inboxItemId)

    if (updateError) { console.error('Error updating inbox item status:', updateError); return false }

    return true
  } catch (err) {
    console.error('Error in saveInboxItemToPage:', err)
    return false
  }
}

// FIX: uses new schema — gdrive_file_id, gdrive_url, pool_account_id, title,
// file_name, file_size_bytes, mime_type, parent_id, depth.
// Removed: file_url, file_size, file_type, uploaded_by, archived.
async function saveAttachmentsToSpecialOrder(
  specialOrderId: string,
  attachments: AttachmentNode[]
): Promise<void> {
  for (const attachment of attachments) {
    const { error } = await supabase
      .from('special_order_attachments')
      .insert({
        special_order_id: specialOrderId,
        title:            attachment.title,
        file_name:        attachment.file_name,
        file_size_bytes:  attachment.file_size_bytes,
        mime_type:        attachment.mime_type,
        gdrive_file_id:   attachment.gdrive_file_id,
        gdrive_url:       attachment.gdrive_url,
        pool_account_id:  attachment.pool_account_id,
        parent_id:        attachment.parent_id,
        depth:            attachment.depth ?? 0,
      })

    if (error) {
      console.error('Error saving attachment:', attachment.title, error)
    }

    if (attachment.children?.length > 0) {
      await saveAttachmentsToSpecialOrder(specialOrderId, attachment.children)
    }
  }
}