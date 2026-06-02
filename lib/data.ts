// lib/data.ts
//
// FIX: All four add* functions now persist Drive pool columns:
//   gdrive_file_id, gdrive_url (as gdrive_url), pool_account_id,
//   file_name, file_size_bytes, mime_type.
//
// FIX (restore): restoreArchivedDoc() now calls /api/gdrive/restore to move
//   the file from the archive subfolder back to the main category folder in
//   Google Drive, before updating the DB status. Previously it only updated
//   the DB and left the file in the archive folder permanently.

import { supabase } from './supabase'
import type {
  User, MasterDocument, SpecialOrder,
  JournalEntry, ConfidentialDoc, LibraryItem,
  ActivityLog, OrgNode
} from '@/types'

export type DailyJournalStatus = 'Draft' | 'Filed' | 'Reviewed'

export type DailyJournalRecord = JournalEntry & {
  content?: string
  summary?: string
  fileUrl?: string
  status: DailyJournalStatus
  attachments: number
  archived?: boolean
  created_at?: string
}

/* ════════════════════════════════════════════
   USERS — kept for authentication only
════════════════════════════════════════════ */
export const USERS: User[] = [
  { id: '1', name: 'Ramon Dela Cruz', email: 'rdelacruz@ddnppo.gov.ph', role: 'admin',   initials: 'RD', avatarColor: '#f0b429' },
  { id: '2', name: 'Ana Santos',      email: 'asantos@ddnppo.gov.ph',   role: 'officer', initials: 'AS', avatarColor: '#3b63b8' },
  { id: '3', name: 'Jose Reyes',      email: 'jreyes@ddnppo.gov.ph',    role: 'officer', initials: 'JR', avatarColor: '#8b5cf6' },
]

/* ════════════════════════════════════════════
   MASTER DOCUMENTS
════════════════════════════════════════════ */

export async function getMasterDocuments(): Promise<(MasterDocument & {
  fileUrl?: string
  uploaded_by?: string
  gdrive_file_id?: string
  gdrive_url?: string
  pool_account_id?: string
  file_name?: string
  file_size_bytes?: number
  mime_type?: string
})[]> {
  const { data, error } = await supabase
    .from('master_documents').select('*').order('created_at', { ascending: true })
  if (error) { console.warn('Supabase unavailable (master_documents):', error.message); return [] }
  return (data ?? []).map(d => ({
    id:              d.id,
    title:           d.title,
    level:           d.level,
    type:            d.type,
    date:            d.date,
    size:            d.size,
    tag:             d.tag,
    fileUrl:         d.file_url          ?? undefined,
    created_at:      d.created_at,
    archived:        d.archived         ?? false,
    uploaded_by:     d.uploaded_by       ?? undefined,
    gdrive_file_id:  d.gdrive_file_id    ?? undefined,
    gdrive_url:      d.gdrive_url        ?? undefined,
    pool_account_id: d.pool_account_id   ?? undefined,
    file_name:       d.file_name         ?? undefined,
    file_size_bytes: d.file_size_bytes   ?? undefined,
    mime_type:       d.mime_type         ?? undefined,
    taggedAdminAccess: Array.isArray(d.tagged_admin_access) ? d.tagged_admin_access : undefined,
  }))
}

export async function addMasterDocument(doc: MasterDocument & {
  fileUrl?:         string
  uploaded_by?:     string
  gdrive_file_id?:  string
  gdrive_url?:      string
  pool_account_id?: string
  file_name?:       string
  file_size_bytes?: number
  mime_type?:       string
}): Promise<void> {
  const { error } = await supabase.from('master_documents').insert({
    id:              doc.id,
    title:           doc.title,
    level:           doc.level,
    type:            doc.type,
    date:            doc.date,
    size:            doc.size,
    tag:             doc.tag,
    file_url:        doc.fileUrl          ?? null,
    uploaded_by:     doc.uploaded_by      ?? null,
    gdrive_file_id:  doc.gdrive_file_id   ?? null,
    gdrive_url:      doc.gdrive_url       ?? null,
    pool_account_id: doc.pool_account_id  ?? null,
    file_name:       doc.file_name        ?? null,
    file_size_bytes: doc.file_size_bytes  ?? null,
    mime_type:       doc.mime_type        ?? null,
  })
  if (error) console.warn('Supabase unavailable (add master_document):', error.message)
}

export async function updateMasterDocument(doc: MasterDocument & { fileUrl?: string }): Promise<void> {
  const { error } = await supabase.from('master_documents')
    .update({
      title: doc.title,
      level: doc.level,
      type:  doc.type,
      date:  doc.date,
      tag:   doc.tag,
    })
    .eq('id', doc.id)
  if (error) console.warn('Supabase unavailable (update master_document):', error.message)
}

export async function archiveMasterDocument(id: string): Promise<void> {
  const { error } = await supabase
    .from('master_documents')
    .update({ archived: true })
    .eq('id', id)
  if (error) console.warn('Supabase unavailable (archive master_document):', error.message)
}

export async function deleteMasterDocument(id: string): Promise<void> {
  const { error } = await supabase.from('master_documents').delete().eq('id', id)
  if (error) console.warn('Supabase unavailable (delete master_document):', error.message)
}

/* ════════════════════════════════════════════
   SPECIAL ORDERS
════════════════════════════════════════════ */

export async function getSpecialOrders(): Promise<(SpecialOrder & {
  fileUrl?:         string
  uploaded_by?:     string
  gdrive_file_id?:  string
  gdrive_url?:      string
  pool_account_id?: string
  file_name?:       string
  file_size_bytes?: number
  mime_type?:       string
})[]> {
  const { data, error } = await supabase
    .from('special_orders').select('*').order('created_at', { ascending: false })
  if (error) { console.warn('Supabase unavailable (special_orders):', error.message); return [] }
  return (data ?? []).map(d => ({
    id:              d.id,
    reference:       d.reference,
    subject:         d.subject,
    date:            d.date,
    attachments:     d.attachments,
    status:          d.status,
    fileUrl:         d.file_url          ?? undefined,
    created_at:      d.created_at,
    archived:        d.archived         ?? false,
    uploaded_by:     d.uploaded_by       ?? undefined,
    gdrive_file_id:  d.gdrive_file_id    ?? undefined,
    gdrive_url:      d.gdrive_url        ?? undefined,
    pool_account_id: d.pool_account_id   ?? undefined,
    file_name:       d.file_name         ?? undefined,
    file_size_bytes: d.file_size_bytes   ?? undefined,
    mime_type:       d.mime_type         ?? undefined,
  }))
}

export async function addSpecialOrder(so: SpecialOrder & {
  fileUrl?:         string
  uploaded_by?:     string
  gdrive_file_id?:  string
  gdrive_url?:      string
  pool_account_id?: string
  file_name?:       string
  file_size_bytes?: number
  mime_type?:       string
}): Promise<void> {
  const { error } = await supabase.from('special_orders').insert({
    id:              so.id,
    reference:       so.reference,
    subject:         so.subject,
    date:            so.date,
    attachments:     so.attachments,
    status:          so.status,
    file_url:        so.fileUrl          ?? null,
    uploaded_by:     so.uploaded_by      ?? null,
    gdrive_file_id:  so.gdrive_file_id   ?? null,
    gdrive_url:      so.gdrive_url       ?? null,
    pool_account_id: so.pool_account_id  ?? null,
    file_name:       so.file_name        ?? null,
    file_size_bytes: so.file_size_bytes  ?? null,
    mime_type:       so.mime_type        ?? null,
  })
  if (error) console.warn('Supabase unavailable (add special_order):', error.message)
}

export async function updateSpecialOrder(so: SpecialOrder & { fileUrl?: string }): Promise<void> {
  const { error } = await supabase
    .from('special_orders')
    .update({
      reference: so.reference,
      subject:   so.subject,
      date:      so.date,
      status:    so.status,
    })
    .eq('id', so.id)
  if (error) console.warn('Supabase unavailable (update special_order):', error.message)
}

export async function updateSpecialOrderAttachment(id: string, fileUrl: string, attachments = 1): Promise<void> {
  const { error } = await supabase
    .from('special_orders')
    .update({ file_url: fileUrl, attachments })
    .eq('id', id)
  if (error) console.warn('Supabase unavailable (update special_order attachment):', error.message)
}

export interface SpecialOrderAttachment {
  id: string
  special_order_id: string
  file_name: string
  file_url: string
  file_size: string
  file_type: string
  uploaded_at: string
  uploaded_by: string
  archived: boolean
}

function normaliseSpecialOrderAttachment(row: any): SpecialOrderAttachment {
  return {
    id:               row.id,
    special_order_id: row.special_order_id,
    file_name:        row.file_name,
    file_url:         row.file_url,
    file_size:        row.file_size,
    file_type:        row.file_type,
    uploaded_at:      row.uploaded_at,
    uploaded_by:      row.uploaded_by,
    archived:         row.archived === true,
  }
}

export async function getSpecialOrderAttachments(specialOrderId: string): Promise<SpecialOrderAttachment[]> {
  const { data, error } = await supabase
    .from('special_order_attachments')
    .select('*')
    .eq('special_order_id', specialOrderId)
    .order('uploaded_at', { ascending: true })

  if (error) {
    console.warn('Supabase unavailable (special_order_attachments):', error.message)
    return []
  }

  return (data ?? []).map(normaliseSpecialOrderAttachment)
}

export async function addSpecialOrderAttachment(
  attachment: Omit<SpecialOrderAttachment, 'uploaded_at'>
): Promise<SpecialOrderAttachment | null> {
  const { data, error } = await supabase
    .from('special_order_attachments')
    .insert({ ...attachment, uploaded_at: new Date().toISOString() })
    .select()
    .single()

  if (error) {
    console.error('Failed to add special_order_attachment:', {
      message: error.message,
      code:    error.code,
      details: error.details,
      hint:    error.hint,
    })
    return null
  }

  return normaliseSpecialOrderAttachment(data)
}

export async function archiveSpecialOrderAttachment(attachmentId: string): Promise<void> {
  const { error } = await supabase
    .from('special_order_attachments')
    .update({ archived: true })
    .eq('id', attachmentId)

  if (error) console.warn('Supabase unavailable (archive special_order_attachment):', error.message)
}

export async function renameSpecialOrderAttachment(attachmentId: string, fileName: string): Promise<boolean> {
  const nextName = fileName.trim()
  if (!nextName) return false

  const { error } = await supabase
    .from('special_order_attachments')
    .update({ file_name: nextName })
    .eq('id', attachmentId)

  if (error) {
    console.warn('Supabase unavailable (rename special_order_attachment):', error.message)
    return false
  }

  return true
}

export async function syncSpecialOrderAttachmentMeta(specialOrderId: string): Promise<{ attachments: number; fileUrl?: string }> {
  const { data, error } = await supabase
    .from('special_order_attachments')
    .select('*')
    .eq('special_order_id', specialOrderId)
    .eq('archived', false)
    .order('uploaded_at', { ascending: false })

  if (error) {
    console.warn('Supabase unavailable (sync special_order meta):', error.message)
    return { attachments: 0 }
  }

  const active     = (data ?? []).map(normaliseSpecialOrderAttachment)
  const latestUrl  = active.length > 0 ? active[0].file_url : null

  const { error: updateError } = await supabase
    .from('special_orders')
    .update({ attachments: active.length, file_url: latestUrl })
    .eq('id', specialOrderId)

  if (updateError) {
    console.warn('Supabase unavailable (update special_order meta):', updateError.message)
  }

  return {
    attachments: active.length,
    fileUrl:     latestUrl ?? undefined,
  }
}

export async function deleteSpecialOrder(id: string): Promise<void> {
  const { error } = await supabase.from('special_orders').delete().eq('id', id)
  if (error) console.warn('Supabase unavailable (delete special_order):', error.message)
}

export async function archiveSpecialOrder(id: string): Promise<void> {
  const { error } = await supabase
    .from('special_orders').update({ status: 'ARCHIVED' }).eq('id', id)
  if (error) console.warn('Supabase unavailable (archive special_order):', error.message)
}

/* ════════════════════════════════════════════
   DAILY JOURNALS
════════════════════════════════════════════ */

export async function getDailyJournals(): Promise<(DailyJournalRecord & {
  uploaded_by?:     string
  gdrive_file_id?:  string
  pool_account_id?: string
  mime_type?:       string
  file_size_bytes?: number
})[]> {
  const { data, error } = await supabase
    .from('daily_journals')
    .select('*')
    .eq('archived', false)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Unable to load daily journals: ${error.message}`)
  }

  return (data ?? []).map(d => ({
    id:              d.id,
    title:           d.title,
    type:            d.type,
    author:          d.author,
    date:            d.date,
    content:         d.content          ?? undefined,
    summary:         d.summary          ?? undefined,
    fileUrl:         d.file_url         ?? undefined,
    status:          d.status,
    attachments:     d.attachments      ?? (d.file_url ? 1 : 0),
    archived:        d.archived         ?? false,
    created_at:      d.created_at,
    uploaded_by:     d.uploaded_by      ?? undefined,
    gdrive_file_id:  d.gdrive_file_id   ?? undefined,
    pool_account_id: d.pool_account_id  ?? undefined,
    mime_type:       d.mime_type        ?? undefined,
    file_size_bytes: d.file_size_bytes  ?? undefined,
  }))
}

export async function addDailyJournal(entry: DailyJournalRecord & {
  uploaded_by?:     string
  gdrive_file_id?:  string
  gdrive_url?:      string
  pool_account_id?: string
  file_name?:       string
  file_size_bytes?: number
  mime_type?:       string
}): Promise<void> {
  const { error } = await supabase
    .from('daily_journals')
    .insert({
      id:              entry.id,
      title:           entry.title,
      type:            entry.type,
      author:          entry.author,
      date:            entry.date,
      content:         entry.content         ?? null,
      summary:         entry.summary         ?? null,
      file_url:        entry.fileUrl         ?? null,
      status:          entry.status,
      attachments:     entry.attachments,
      archived:        entry.archived        ?? false,
      uploaded_by:     entry.uploaded_by     ?? null,
      gdrive_file_id:  entry.gdrive_file_id  ?? null,
      gdrive_url:      entry.gdrive_url      ?? null,
      pool_account_id: entry.pool_account_id ?? null,
      file_name:       entry.file_name       ?? null,
      file_size_bytes: entry.file_size_bytes ?? null,
      mime_type:       entry.mime_type       ?? null,
    })

  if (error) throw new Error(`Unable to save daily journal: ${error.message}`)
}

export async function updateDailyJournal(entry: DailyJournalRecord): Promise<void> {
  const { error } = await supabase
    .from('daily_journals')
    .update({
      title:       entry.title,
      type:        entry.type,
      author:      entry.author,
      date:        entry.date,
      content:     entry.content   ?? null,
      summary:     entry.summary   ?? null,
      file_url:    entry.fileUrl   ?? null,
      status:      entry.status,
      attachments: entry.attachments,
      archived:    entry.archived  ?? false,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', entry.id)

  if (error) throw new Error(`Unable to update daily journal: ${error.message}`)
}

export async function archiveDailyJournal(id: string): Promise<void> {
  const { error } = await supabase
    .from('daily_journals')
    .update({ archived: true, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(`Unable to archive daily journal: ${error.message}`)
}

export async function deleteDailyJournal(id: string): Promise<void> {
  const { error } = await supabase
    .from('daily_journals')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Unable to delete daily journal: ${error.message}`)
}

/* ════════════════════════════════════════════
   CONFIDENTIAL DOCUMENTS
════════════════════════════════════════════ */
export async function getConfidentialDocs(): Promise<(ConfidentialDoc & { fileUrl?: string; passwordHash?: string; archived?: boolean })[]> {
  const { data, error } = await supabase
    .from('confidential_docs').select('*').order('created_at', { ascending: false })
  if (error) { console.warn('Supabase unavailable (confidential_docs):', error.message); return [] }
  return (data ?? []).map(d => ({
    id:           d.id,
    title:        d.title,
    classification: d.classification,
    date:         d.date,
    access:       d.access,
    fileUrl:      d.file_url      ?? undefined,
    passwordHash: d.password_hash ?? undefined,
    archived:     d.archived      ?? false,
    created_at:   d.created_at,
  }))
}

export async function addConfidentialDoc(
  doc: ConfidentialDoc & { fileUrl?: string; passwordHash?: string }
): Promise<boolean> {
  const { error } = await supabase.from('confidential_docs').insert({
    id:             doc.id,
    title:          doc.title,
    classification: doc.classification,
    date:           doc.date,
    access:         doc.access,
    file_url:       doc.fileUrl      ?? null,
    password_hash:  doc.passwordHash ?? null,
  })
  if (error) {
    console.warn('Supabase unavailable (add confidential_doc):', error.message)
    return false
  }

  return true
}

export async function updateConfidentialDoc(
  id: string,
  updates: {
    title: string
    classification: ConfidentialDoc['classification']
    date: string
    access: string
    fileUrl?: string | null
    passwordHash?: string | null
  }
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    title:          updates.title,
    classification: updates.classification,
    date:           updates.date,
    access:         updates.access,
  }

  if (updates.fileUrl      !== undefined) payload.file_url      = updates.fileUrl
  if (updates.passwordHash !== undefined) payload.password_hash = updates.passwordHash

  const { error } = await supabase
    .from('confidential_docs')
    .update(payload)
    .eq('id', id)

  if (error) {
    console.warn('Supabase unavailable (update confidential_doc):', error.message)
    return false
  }

  return true
}

export async function deleteConfidentialDoc(id: string): Promise<void> {
  const { error } = await supabase.from('confidential_docs').delete().eq('id', id)
  if (error) console.warn('Supabase unavailable (delete confidential_doc):', error.message)
}

export async function archiveConfidentialDoc(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('confidential_docs').update({ archived: true }).eq('id', id)
  if (error) {
    console.warn('Supabase unavailable (archive confidential_doc):', error.message)
    return false
  }

  return true
}

/* ════════════════════════════════════════════
   LIBRARY ITEMS
════════════════════════════════════════════ */

export async function getLibraryItems(): Promise<(LibraryItem & {
  fileUrl?:         string
  description?:     string
  uploaded_by?:     string
  gdrive_file_id?:  string
  gdrive_url?:      string
  pool_account_id?: string
  file_name?:       string
  file_size_bytes?: number
  mime_type?:       string
})[]> {
  const { data, error } = await supabase
    .from('library_items').select('*').order('created_at', { ascending: false })
  if (error) { console.warn('Supabase unavailable (library_items):', error.message); return [] }
  return (data ?? []).map(d => ({
    id:              d.id,
    title:           d.title,
    category:        d.category,
    size:            d.size,
    dateAdded:       d.date_added,
    fileUrl:         d.file_url          ?? undefined,
    description:     d.description       ?? undefined,
    created_at:      d.created_at,
    archived:        d.archived         ?? false,
    uploaded_by:     d.uploaded_by       ?? undefined,
    gdrive_file_id:  d.gdrive_file_id    ?? undefined,
    gdrive_url:      d.gdrive_url        ?? undefined,
    pool_account_id: d.pool_account_id   ?? undefined,
    file_name:       d.file_name         ?? undefined,
    file_size_bytes: d.file_size_bytes   ?? undefined,
    mime_type:       d.mime_type         ?? undefined,
  }))
}

export async function addLibraryItem(
  item: LibraryItem & {
    fileUrl?:         string
    description?:     string
    uploaded_by?:     string
    gdrive_file_id?:  string
    gdrive_url?:      string
    pool_account_id?: string
    file_name?:       string
    file_size_bytes?: number
    mime_type?:       string
  }
): Promise<void> {
  const { error } = await supabase.from('library_items').insert({
    id:              item.id,
    title:           item.title,
    category:        item.category,
    size:            item.size,
    date_added:      item.dateAdded,
    file_url:        item.fileUrl         ?? null,
    description:     item.description     ?? null,
    uploaded_by:     item.uploaded_by     ?? null,
    gdrive_file_id:  item.gdrive_file_id  ?? null,
    gdrive_url:      item.gdrive_url      ?? null,
    pool_account_id: item.pool_account_id ?? null,
    file_name:       item.file_name       ?? null,
    file_size_bytes: item.file_size_bytes ?? null,
    mime_type:       item.mime_type       ?? null,
  })
  if (error) console.warn('Supabase unavailable (add library_item):', error.message)
}

export async function updateLibraryItem(
  item: LibraryItem & { fileUrl?: string; description?: string }
): Promise<void> {
  const { error } = await supabase
    .from('library_items')
    .update({
      title:       item.title,
      category:    item.category,
      date_added:  item.dateAdded,
      description: item.description ?? null,
    })
    .eq('id', item.id)
  if (error) console.warn('Supabase unavailable (update library_item):', error.message)
}

export async function deleteLibraryItem(id: string): Promise<void> {
  const { error } = await supabase.from('library_items').delete().eq('id', id)
  if (error) console.warn('Supabase unavailable (delete library_item):', error.message)
}

export async function archiveLibraryItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('library_items')
    .update({ archived: true })
    .eq('id', id)
  if (error) console.warn('Supabase unavailable (archive library_item):', error.message)
}

/* ════════════════════════════════════════════
   ACTIVITY LOGS
════════════════════════════════════════════ */
export async function getActivityLogs(): Promise<ActivityLog[]> {
  const { data, error } = await supabase
    .from('activity_logs').select('*').order('created_at', { ascending: false })
  if (error) { console.warn('Supabase unavailable (activity_logs):', error.message); return [] }
  return (data ?? []).map(d => ({
    id:           d.id,
    user:         d.user_name,
    userInitials: d.user_initials,
    userColor:    d.user_color,
    action:       d.action,
    document:     d.document,
    date:         d.date,
    time:         d.time,
    device:       d.device,
  }))
}

export async function addActivityLog(log: ActivityLog): Promise<void> {
  const { error } = await supabase.from('activity_logs').insert({
    id:            log.id,
    user_name:     log.user,
    user_initials: log.userInitials,
    user_color:    log.userColor,
    action:        log.action,
    document:      log.document,
    date:          log.date,
    time:          log.time,
    device:        log.device,
  })
  if (error) console.warn('Supabase unavailable (add activity_log):', error.message)
}

/* ════════════════════════════════════════════
   ARCHIVED DOCUMENTS
════════════════════════════════════════════ */
export async function getArchivedDocs() {
  const { data, error } = await supabase
    .from('archived_docs').select('*').order('created_at', { ascending: false })
  if (error) { console.warn('Supabase unavailable (archived_docs):', error.message); return [] }
  return data ?? []
}

export async function addArchivedDoc(item: {
  id: string; title: string; type: string; archivedDate: string; archivedBy: string
}): Promise<boolean> {
  const { error } = await supabase.from('archived_docs').insert({
    id:            item.id,
    title:         item.title,
    type:          item.type,
    archived_date: item.archivedDate,
    archived_by:   item.archivedBy,
  })
  if (error) {
    console.warn('Supabase unavailable (add archived_doc):', error.message)
    return false
  }

  return true
}

export async function deleteArchivedDoc(id: string): Promise<void> {
  const { error } = await supabase.from('archived_docs').delete().eq('id', id)
  if (error) console.warn('Supabase unavailable (delete archived_doc):', error.message)
}

// ── archived_docs.id prefix → source table mapping ───────────────────────────
// Used by restoreArchivedDoc to look up the original document row for its
// Drive metadata (gdrive_file_id, pool_account_id) before calling the
// /api/gdrive/restore endpoint.
const PREFIX_TO_TABLE: Record<string, string> = {
  'arc-so-':  'special_orders',
  'arc-cd-':  'confidential_docs',
  'arc-md-':  'master_documents',
  'arc-lib-': 'library_items',
  'arc-dj-':  'daily_journals',
}

// archived_docs.type → Drive category string (must match CATEGORY_DISPLAY_NAMES keys)
const ARCHIVE_TYPE_TO_DRIVE_CATEGORY: Record<string, string> = {
  'Special Order':        'special_orders',
  'Classified Document':  'classified_documents',
  'Master Document':      'master_documents',
  'Library Item':         'library_items',
  'Daily Journal':        'daily_journals',
}

/**
 * Calls /api/gdrive/restore to move a file from the archive subfolder back to
 * the main category folder in Google Drive.
 *
 * Non-throwing: logs a warning on failure but does NOT block the DB restore
 * that follows.  The file stays in the archive folder on Drive in that case,
 * but the document is still visible again in the UI.
 */
async function callDriveRestoreApi(params: {
  gdriveFileId:  string
  poolAccountId: string
  category:      string
}): Promise<void> {
  try {
    const res = await fetch('/api/gdrive/restore', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(params),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      console.warn(
        `[restoreArchivedDoc] Drive restore API returned ${res.status}:`,
        json.error ?? '(no detail)'
      )
    }
  } catch (err: any) {
    console.warn('[restoreArchivedDoc] Drive restore call failed (non-fatal):', err.message)
  }
}

export async function restoreArchivedDoc(id: string): Promise<void> {
  // ── 1. Fetch the archived_docs row ────────────────────────────────────────
  const { data: archived, error: fetchError } = await supabase
    .from('archived_docs')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    console.warn('Supabase unavailable (fetch archived_doc):', fetchError.message)
  }

  const archiveType = String(archived?.type ?? '').trim()

  // ── 2. Derive the original document ID from the arc-xx- prefix ───────────
  let sourceId: string | undefined
  let sourceTable: string | undefined

  for (const [prefix, table] of Object.entries(PREFIX_TO_TABLE)) {
    if (id.startsWith(prefix)) {
      sourceId    = id.slice(prefix.length)
      sourceTable = table
      break
    }
  }

  // ── 3. Move file in Drive back to the main folder ────────────────────────
  //   Fetch the original document row to get its gdrive_file_id and
  //   pool_account_id, then call /api/gdrive/restore.
  if (sourceId && sourceTable) {
    const driveCategory = ARCHIVE_TYPE_TO_DRIVE_CATEGORY[archiveType]

    if (driveCategory) {
      const { data: sourceRow } = await supabase
        .from(sourceTable)
        .select('gdrive_file_id, pool_account_id')
        .eq('id', sourceId)
        .maybeSingle()

      const gdriveFileId  = (sourceRow as any)?.gdrive_file_id
      const poolAccountId = (sourceRow as any)?.pool_account_id

      if (gdriveFileId && poolAccountId) {
        await callDriveRestoreApi({ gdriveFileId, poolAccountId, category: driveCategory })
      } else {
        console.warn(
          `[restoreArchivedDoc] Source row ${sourceTable}/${sourceId} has no Drive ` +
          `metadata (gdrive_file_id=${gdriveFileId}, pool_account_id=${poolAccountId}). ` +
          `Skipping Drive file move — DB status will still be restored.`
        )
      }
    }
  }

  // ── 4. Update DB status back to active ────────────────────────────────────

  if (id.startsWith('arc-so-') || archiveType === 'Special Order') {
    if (sourceId) {
      const { error } = await supabase
        .from('special_orders')
        .update({ status: 'ACTIVE' })
        .eq('id', sourceId)
      if (error) console.warn('Supabase unavailable (restore special_order):', error.message)
    }
  }

  if (id.startsWith('arc-cd-') || archiveType === 'Classified Document') {
    if (sourceId) {
      const { error } = await supabase
        .from('confidential_docs')
        .update({ archived: false })
        .eq('id', sourceId)
      if (error) console.warn('Supabase unavailable (restore confidential_doc):', error.message)
    }
  }

  if (id.startsWith('arc-md-') || archiveType === 'Master Document') {
    if (sourceId) {
      const { error } = await supabase
        .from('master_documents')
        .update({ archived: false })
        .eq('id', sourceId)
      if (error) console.warn('Supabase unavailable (restore master_document):', error.message)
    }
  }

  if (id.startsWith('arc-lib-') || archiveType === 'Library Item') {
    if (sourceId) {
      const { error } = await supabase
        .from('library_items')
        .update({ archived: false })
        .eq('id', sourceId)
      if (error) console.warn('Supabase unavailable (restore library_item):', error.message)
    }
  }

  if (id.startsWith('arc-dj-') || archiveType === 'Daily Journal') {
    if (sourceId) {
      const { error } = await supabase
        .from('daily_journals')
        .update({ archived: false, updated_at: new Date().toISOString() })
        .eq('id', sourceId)
      if (error) console.warn('Supabase unavailable (restore daily_journal):', error.message)
    }
  }

  // ── 5. Remove the archived_docs row ───────────────────────────────────────
  const { error } = await supabase.from('archived_docs').delete().eq('id', id)
  if (error) console.warn('Supabase unavailable (delete archived_doc on restore):', error.message)
}


/**
 * Deletes a file from Google Drive via the pool gateway.
 * Non-throwing — a Drive failure never blocks Supabase metadata cleanup.
 * Safe to call when gdrive_file_id or pool_account_id may be undefined
 * (pre-migration documents simply skip the Drive call).
 */
export async function deleteDriveFile(
  gdriveFileId: string | undefined | null,
  poolAccountId: string | undefined | null
): Promise<void> {
  if (!gdriveFileId || !poolAccountId) return

  try {
    const res = await fetch('/api/gdrive/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gdriveFileId, poolAccountId }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      console.warn('[deleteDriveFile] API returned error:', json.error ?? res.status)
    }
  } catch (err: any) {
    console.warn('[deleteDriveFile] Non-fatal network error:', err.message)
  }
}

/* ════════════════════════════════════════════
   ORG CHART — placeholder
════════════════════════════════════════════ */
export const ORG_CHART: OrgNode = {
  id:       'org-root',
  initials: '--',
  rank:     '',
  name:     'No Data',
  title:    'Add personnel to populate the org chart',
  unit:     '',
  color:    '#94a3b8',
  children: [],
}

/* ════════════════════════════════════════════
   LEGACY EXPORTS
════════════════════════════════════════════ */
export const MASTER_DOCUMENTS:  MasterDocument[]  = []
export const SPECIAL_ORDERS:    SpecialOrder[]    = []
export const JOURNAL_ENTRIES:   JournalEntry[]    = []
export const CONFIDENTIAL_DOCS: ConfidentialDoc[] = []
export const LIBRARY_ITEMS:     LibraryItem[]     = []
export const ACTIVITY_LOGS:     ActivityLog[]     = []