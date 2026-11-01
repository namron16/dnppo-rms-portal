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

import { supabase } from "./supabase";
import type {
  User,
  MasterDocument,
  SpecialOrder,
  JournalEntry,
  ConfidentialDoc,
  LibraryItem,
  ActivityLog,
  OrgNode,
} from "@/types";

export type DailyJournalStatus = "Draft" | "Filed" | "Reviewed";

export type DailyJournalRecord = JournalEntry & {
  content?: string;
  summary?: string;
  fileUrl?: string;
  status: DailyJournalStatus;
  attachments: number;
  archived?: boolean;
  created_at?: string;
};

function must(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`${action} failed: ${error.message}`);
}

/* ════════════════════════════════════════════
   MASTER DOCUMENTS
════════════════════════════════════════════ */

export async function getMasterDocuments(): Promise<
  (MasterDocument & {
    fileUrl?: string;
    uploaded_by?: string;
    gdrive_file_id?: string;
    gdrive_url?: string;
    pool_account_id?: string;
    file_name?: string;
    file_size_bytes?: number;
    mime_type?: string;
  })[]
> {
  const { data, error } = await supabase
    .from("master_documents")
    .select(
      "id, title, level, type, date, size, tag, file_url, archived, uploaded_by, gdrive_file_id, gdrive_url, pool_account_id, file_name, file_size_bytes, mime_type, tagged_admin_access, created_at"
    )
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("Supabase unavailable (master_documents):", error.message);
    return [];
  }
  return (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    level: d.level,
    type: d.type,
    date: d.date,
    size: d.size,
    tag: d.tag,
    fileUrl: d.file_url ?? undefined,
    created_at: d.created_at,
    archived: d.archived ?? false,
    uploaded_by: d.uploaded_by ?? undefined,
    gdrive_file_id: d.gdrive_file_id ?? undefined,
    gdrive_url: d.gdrive_url ?? undefined,
    pool_account_id: d.pool_account_id ?? undefined,
    file_name: d.file_name ?? undefined,
    file_size_bytes: d.file_size_bytes ?? undefined,
    mime_type: d.mime_type ?? undefined,
    taggedAdminAccess: Array.isArray(d.tagged_admin_access)
      ? d.tagged_admin_access
      : undefined,
  }));
}

export async function addMasterDocument(
  doc: MasterDocument & {
    fileUrl?: string;
    uploaded_by?: string;
    gdrive_file_id?: string;
    gdrive_url?: string;
    pool_account_id?: string;
    file_name?: string;
    file_size_bytes?: number;
    mime_type?: string;
  }
): Promise<void> {
  const { error } = await supabase.from("master_documents").insert({
    id: doc.id,
    title: doc.title,
    level: doc.level,
    type: doc.type,
    date: doc.date,
    size: doc.size,
    tag: doc.tag,
    file_url: doc.fileUrl ?? null,
    uploaded_by: doc.uploaded_by ?? null,
    gdrive_file_id: doc.gdrive_file_id ?? null,
    gdrive_url: doc.gdrive_url ?? null,
    pool_account_id: doc.pool_account_id ?? null,
    file_name: doc.file_name ?? null,
    file_size_bytes: doc.file_size_bytes ?? null,
    mime_type: doc.mime_type ?? null,
  });
  if (error) must(error, "Saving master document");
}

export async function updateMasterDocument(
  doc: MasterDocument & { fileUrl?: string }
): Promise<void> {
  const { error } = await supabase
    .from("master_documents")
    .update({
      title: doc.title,
      level: doc.level,
      type: doc.type,
      date: doc.date,
      tag: doc.tag,
    })
    .eq("id", doc.id);
  if (error) must(error, "Updating master document");
}

export async function archiveMasterDocument(id: string): Promise<void> {
  const { error } = await supabase
    .from("master_documents")
    .update({ archived: true })
    .eq("id", id);
  if (error)
    console.warn(
      "Supabase unavailable (archive master_document):",
      error.message
    );
}

export async function deleteMasterDocument(id: string): Promise<void> {
  const { error } = await supabase
    .from("master_documents")
    .delete()
    .eq("id", id);
  if (error) must(error, "Deleting master document");
}

/* ════════════════════════════════════════════
   SPECIAL ORDERS
════════════════════════════════════════════ */

export async function getSpecialOrders(): Promise<
  (SpecialOrder & {
    fileUrl?: string;
    uploaded_by?: string;
    gdrive_file_id?: string;
    gdrive_url?: string;
    pool_account_id?: string;
    file_name?: string;
    file_size_bytes?: number;
    mime_type?: string;
  })[]
> {
  const { data, error } = await supabase
    .from("special_orders")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("Supabase unavailable (special_orders):", error.message);
    return [];
  }
  return (data ?? []).map((d) => ({
    id: d.id,
    reference: d.reference,
    subject: d.subject,
    date: d.date,
    attachments: d.attachments,
    status: d.status,
    fileUrl: d.file_url ?? undefined,
    created_at: d.created_at,
    archived: d.archived ?? false,
    uploaded_by: d.uploaded_by ?? undefined,
    gdrive_file_id: d.gdrive_file_id ?? undefined,
    gdrive_url: d.gdrive_url ?? undefined,
    pool_account_id: d.pool_account_id ?? undefined,
    file_name: d.file_name ?? undefined,
    file_size_bytes: d.file_size_bytes ?? undefined,
    mime_type: d.mime_type ?? undefined,
  }));
}

export async function addSpecialOrder(
  so: SpecialOrder & {
    fileUrl?: string;
    uploaded_by?: string;
    gdrive_file_id?: string;
    gdrive_url?: string;
    pool_account_id?: string;
    file_name?: string;
    file_size_bytes?: number;
    mime_type?: string;
  }
): Promise<void> {
  const { error } = await supabase.from("special_orders").insert({
    id: so.id,
    reference: so.reference,
    subject: so.subject,
    date: so.date,
    attachments: so.attachments,
    status: so.status,
    file_url: so.fileUrl ?? null,
    uploaded_by: so.uploaded_by ?? null,
    gdrive_file_id: so.gdrive_file_id ?? null,
    gdrive_url: so.gdrive_url ?? null,
    pool_account_id: so.pool_account_id ?? null,
    file_name: so.file_name ?? null,
    file_size_bytes: so.file_size_bytes ?? null,
    mime_type: so.mime_type ?? null,
  });
  if (error) must(error, "Saving special order");
}

export async function updateSpecialOrder(
  so: SpecialOrder & { fileUrl?: string }
): Promise<void> {
  const { error } = await supabase
    .from("special_orders")
    .update({
      reference: so.reference,
      subject: so.subject,
      date: so.date,
      status: so.status,
    })
    .eq("id", so.id);
  if (error) must(error, "Updating special order");
}

export async function updateSpecialOrderAttachment(
  id: string,
  fileUrl: string,
  attachments = 1
): Promise<void> {
  const { error } = await supabase
    .from("special_orders")
    .update({ file_url: fileUrl, attachments })
    .eq("id", id);
  if (error)
    console.warn(
      "Supabase unavailable (update special_order attachment):",
      error.message
    );
}

export interface SpecialOrderAttachment {
  id: string;
  special_order_id: string;
  file_name: string;
  file_url: string;
  file_size: string;
  file_type: string;
  uploaded_at: string;
  uploaded_by: string;
  archived: boolean;
}

function normaliseSpecialOrderAttachment(row: any): SpecialOrderAttachment {
  return {
    id: row.id,
    special_order_id: row.special_order_id,
    file_name: row.file_name,
    file_url: row.file_url,
    file_size: row.file_size,
    file_type: row.file_type,
    uploaded_at: row.uploaded_at,
    uploaded_by: row.uploaded_by,
    archived: row.archived === true,
  };
}

export async function getSpecialOrderAttachments(
  specialOrderId: string
): Promise<SpecialOrderAttachment[]> {
  const { data, error } = await supabase
    .from("special_order_attachments")
    .select("*")
    .eq("special_order_id", specialOrderId)
    .order("uploaded_at", { ascending: true });

  if (error) {
    console.warn(
      "Supabase unavailable (special_order_attachments):",
      error.message
    );
    return [];
  }

  return (data ?? []).map(normaliseSpecialOrderAttachment);
}

export async function addSpecialOrderAttachment(
  attachment: Omit<SpecialOrderAttachment, "uploaded_at">
): Promise<SpecialOrderAttachment | null> {
  const { data, error } = await supabase
    .from("special_order_attachments")
    .insert({ ...attachment, uploaded_at: new Date().toISOString() })
    .select()
    .single();

  if (error) {
    console.error("Failed to add special_order_attachment:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return null;
  }

  return normaliseSpecialOrderAttachment(data);
}

export async function archiveSpecialOrderAttachment(
  attachmentId: string
): Promise<void> {
  const { error } = await supabase
    .from("special_order_attachments")
    .update({ archived: true })
    .eq("id", attachmentId);

  if (error)
    console.warn(
      "Supabase unavailable (archive special_order_attachment):",
      error.message
    );
}

export async function renameSpecialOrderAttachment(
  attachmentId: string,
  fileName: string
): Promise<boolean> {
  const nextName = fileName.trim();
  if (!nextName) return false;

  const { error } = await supabase
    .from("special_order_attachments")
    .update({ file_name: nextName })
    .eq("id", attachmentId);

  if (error) {
    console.warn(
      "Supabase unavailable (rename special_order_attachment):",
      error.message
    );
    return false;
  }

  return true;
}

export async function syncSpecialOrderAttachmentMeta(
  specialOrderId: string
): Promise<{ attachments: number; fileUrl?: string }> {
  const { data, error } = await supabase
    .from("special_order_attachments")
    .select("*")
    .eq("special_order_id", specialOrderId)
    .eq("archived", false)
    .order("uploaded_at", { ascending: false });

  if (error) {
    console.warn(
      "Supabase unavailable (sync special_order meta):",
      error.message
    );
    return { attachments: 0 };
  }

  const active = (data ?? []).map(normaliseSpecialOrderAttachment);
  const latestUrl = active.length > 0 ? active[0].file_url : null;

  const { error: updateError } = await supabase
    .from("special_orders")
    .update({ attachments: active.length, file_url: latestUrl })
    .eq("id", specialOrderId);

  if (updateError) {
    console.warn(
      "Supabase unavailable (update special_order meta):",
      updateError.message
    );
  }

  return {
    attachments: active.length,
    fileUrl: latestUrl ?? undefined,
  };
}

export async function deleteSpecialOrder(id: string): Promise<void> {
  const { error } = await supabase.from("special_orders").delete().eq("id", id);
  if (error)
    console.warn("Supabase unavailable (delete special_order):", error.message);
}

export async function archiveSpecialOrder(id: string): Promise<void> {
  const { error } = await supabase
    .from("special_orders")
    .update({ status: "ARCHIVED" })
    .eq("id", id);
  if (error) must(error, "Deleting special order");
}

/* ════════════════════════════════════════════
   DAILY JOURNALS
════════════════════════════════════════════ */

export async function getDailyJournals(): Promise<
  (DailyJournalRecord & {
    uploaded_by?: string;
    gdrive_file_id?: string;
    pool_account_id?: string;
    mime_type?: string;
    file_size_bytes?: number;
  })[]
> {
  const { data, error } = await supabase
    .from("daily_journals")
    .select("*")
    .eq("archived", false)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Unable to load daily journals: ${error.message}`);
  }

  return (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    type: d.type,
    author: d.author,
    date: d.date,
    content: d.content ?? undefined,
    summary: d.summary ?? undefined,
    fileUrl: d.file_url ?? undefined,
    status: d.status,
    attachments: d.attachments ?? (d.file_url ? 1 : 0),
    archived: d.archived ?? false,
    created_at: d.created_at,
    uploaded_by: d.uploaded_by ?? undefined,
    gdrive_file_id: d.gdrive_file_id ?? undefined,
    pool_account_id: d.pool_account_id ?? undefined,
    mime_type: d.mime_type ?? undefined,
    file_size_bytes: d.file_size_bytes ?? undefined,
  }));
}

export async function addDailyJournal(
  entry: DailyJournalRecord & {
    uploaded_by?: string;
    gdrive_file_id?: string;
    gdrive_url?: string;
    pool_account_id?: string;
    file_name?: string;
    file_size_bytes?: number;
    mime_type?: string;
  }
): Promise<void> {
  const { error } = await supabase.from("daily_journals").insert({
    id: entry.id,
    title: entry.title,
    type: entry.type,
    author: entry.author,
    date: entry.date,
    content: entry.content ?? null,
    summary: entry.summary ?? null,
    file_url: entry.fileUrl ?? null,
    status: entry.status,
    attachments: entry.attachments,
    archived: entry.archived ?? false,
    uploaded_by: entry.uploaded_by ?? null,
    gdrive_file_id: entry.gdrive_file_id ?? null,
    gdrive_url: entry.gdrive_url ?? null,
    pool_account_id: entry.pool_account_id ?? null,
    file_name: entry.file_name ?? null,
    file_size_bytes: entry.file_size_bytes ?? null,
    mime_type: entry.mime_type ?? null,
  });

  if (error) must(error, "Saving library item");
}

export async function updateDailyJournal(
  entry: DailyJournalRecord
): Promise<void> {
  const { error } = await supabase
    .from("daily_journals")
    .update({
      title: entry.title,
      type: entry.type,
      author: entry.author,
      date: entry.date,
      content: entry.content ?? null,
      summary: entry.summary ?? null,
      file_url: entry.fileUrl ?? null,
      status: entry.status,
      attachments: entry.attachments,
      archived: entry.archived ?? false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", entry.id);

  if (error) must(error, "Updating library item");
}

export async function archiveDailyJournal(id: string): Promise<void> {
  const { error } = await supabase
    .from("daily_journals")
    .update({ archived: true, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error)
    throw new Error(`Unable to archive daily journal: ${error.message}`);
}

export async function deleteDailyJournal(id: string): Promise<void> {
  const { error } = await supabase.from("daily_journals").delete().eq("id", id);

  if (error) must(error, "Deleting library item");
}

/* ════════════════════════════════════════════
   CONFIDENTIAL DOCUMENTS
════════════════════════════════════════════ */
export async function getConfidentialDocs(): Promise<
  (ConfidentialDoc & {
    fileUrl?: string;
    passwordHash?: string;
    archived?: boolean;
  })[]
> {
  const { data, error } = await supabase
    .from("confidential_docs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("Supabase unavailable (confidential_docs):", error.message);
    return [];
  }
  return (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    classification: d.classification,
    date: d.date,
    access: d.access,
    fileUrl: d.file_url ?? undefined,
    passwordHash: d.password_hash ?? undefined,
    archived: d.archived ?? false,
    created_at: d.created_at,
  }));
}

export async function addConfidentialDoc(doc: any): Promise<boolean> {
  const { error } = await supabase.from("confidential_docs").insert({
    id: doc.id,
    title: doc.title,
    classification: doc.classification,
    date: doc.date,
    access: doc.access,
    file_url: doc.fileUrl ?? null,
    password_hash: doc.passwordHash ?? null,
    // FIX: persist Drive identifiers — required for delete and archive
    gdrive_file_id: doc.gdrive_file_id ?? null,
    gdrive_url: doc.gdrive_url ?? null,
    pool_account_id: doc.pool_account_id ?? null,
  });
  if (error) {
    console.error("addConfidentialDoc error:", error.message);
    return false;
  }
  return true;
}

export async function updateConfidentialDoc(
  id: string,
  updates: {
    title: string;
    classification: ConfidentialDoc["classification"];
    date: string;
    access: string;
    fileUrl?: string | null;
    passwordHash?: string | null;
  }
): Promise<boolean> {
  const payload: Record<string, unknown> = {
    title: updates.title,
    classification: updates.classification,
    date: updates.date,
    access: updates.access,
  };

  if (updates.fileUrl !== undefined) payload.file_url = updates.fileUrl;
  if (updates.passwordHash !== undefined)
    payload.password_hash = updates.passwordHash;

  const { error } = await supabase
    .from("confidential_docs")
    .update(payload)
    .eq("id", id);

  if (error) {
    console.warn(
      "Supabase unavailable (update confidential_doc):",
      error.message
    );
    return false;
  }

  return true;
}

export async function deleteConfidentialDoc(id: string): Promise<void> {
  const { error } = await supabase
    .from("confidential_docs")
    .delete()
    .eq("id", id);
  if (error) must(error, "Deleting classified document");
}

export async function archiveConfidentialDoc(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("confidential_docs")
    .update({ archived: true })
    .eq("id", id);
  if (error) {
    console.warn(
      "Supabase unavailable (archive confidential_doc):",
      error.message
    );
    return false;
  }

  return true;
}

/* ════════════════════════════════════════════
   LIBRARY ITEMS
════════════════════════════════════════════ */

export async function getLibraryItems(): Promise<
  (LibraryItem & {
    fileUrl?: string;
    description?: string;
    uploaded_by?: string;
    gdrive_file_id?: string;
    gdrive_url?: string;
    pool_account_id?: string;
    file_name?: string;
    file_size_bytes?: number;
    mime_type?: string;
  })[]
> {
  const { data, error } = await supabase
    .from("library_items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("Supabase unavailable (library_items):", error.message);
    return [];
  }
  return (data ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    category: d.category,
    size: d.size,
    dateAdded: d.date_added,
    fileUrl: d.file_url ?? undefined,
    description: d.description ?? undefined,
    created_at: d.created_at,
    archived: d.archived ?? false,
    uploaded_by: d.uploaded_by ?? undefined,
    gdrive_file_id: d.gdrive_file_id ?? undefined,
    gdrive_url: d.gdrive_url ?? undefined,
    pool_account_id: d.pool_account_id ?? undefined,
    file_name: d.file_name ?? undefined,
    file_size_bytes: d.file_size_bytes ?? undefined,
    mime_type: d.mime_type ?? undefined,
  }));
}

export async function addLibraryItem(
  item: LibraryItem & {
    fileUrl?: string;
    description?: string;
    uploaded_by?: string;
    gdrive_file_id?: string;
    gdrive_url?: string;
    pool_account_id?: string;
    file_name?: string;
    file_size_bytes?: number;
    mime_type?: string;
  }
): Promise<void> {
  const { error } = await supabase.from("library_items").insert({
    id: item.id,
    title: item.title,
    category: item.category,
    size: item.size,
    date_added: item.dateAdded,
    file_url: item.fileUrl ?? null,
    description: item.description ?? null,
    uploaded_by: item.uploaded_by ?? null,
    gdrive_file_id: item.gdrive_file_id ?? null,
    gdrive_url: item.gdrive_url ?? null,
    pool_account_id: item.pool_account_id ?? null,
    file_name: item.file_name ?? null,
    file_size_bytes: item.file_size_bytes ?? null,
    mime_type: item.mime_type ?? null,
  });
  if (error)
    console.warn("Supabase unavailable (add library_item):", error.message);
}

export async function updateLibraryItem(
  item: LibraryItem & { fileUrl?: string; description?: string }
): Promise<void> {
  const { error } = await supabase
    .from("library_items")
    .update({
      title: item.title,
      category: item.category,
      date_added: item.dateAdded,
      description: item.description ?? null,
    })
    .eq("id", item.id);
  if (error)
    console.warn("Supabase unavailable (update library_item):", error.message);
}

export async function deleteLibraryItem(id: string): Promise<void> {
  const { error } = await supabase.from("library_items").delete().eq("id", id);
  if (error)
    console.warn("Supabase unavailable (delete library_item):", error.message);
}

export async function archiveLibraryItem(id: string): Promise<void> {
  const { error } = await supabase
    .from("library_items")
    .update({ archived: true })
    .eq("id", id);
  if (error)
    console.warn("Supabase unavailable (archive library_item):", error.message);
}

/* ════════════════════════════════════════════
   ACTIVITY LOGS
════════════════════════════════════════════ */
export async function getActivityLogs(): Promise<ActivityLog[]> {
  const { data, error } = await supabase
    .from("activity_logs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("Supabase unavailable (activity_logs):", error.message);
    return [];
  }
  return (data ?? []).map((d) => ({
    id: d.id,
    user: d.user_name,
    userInitials: d.user_initials,
    userColor: d.user_color,
    action: d.action,
    document: d.document,
    date: d.date,
    time: d.time,
    device: d.device,
  }));
}

export async function addActivityLog(log: ActivityLog): Promise<void> {
  const { error } = await supabase.from("activity_logs").insert({
    id: log.id,
    user_name: log.user,
    user_initials: log.userInitials,
    user_color: log.userColor,
    action: log.action,
    document: log.document,
    date: log.date,
    time: log.time,
    device: log.device,
  });
  if (error)
    console.warn("Supabase unavailable (add activity_log):", error.message);
}

/* ════════════════════════════════════════════
   ARCHIVED DOCUMENTS
════════════════════════════════════════════ */
export async function getArchivedDocs(idPrefix?: string) {
  let q = supabase
    .from("archived_docs")
    .select("*")
    .order("created_at", { ascending: false });
  if (idPrefix) q = q.like("id", `${idPrefix}%`);
  const { data, error } = await q;
  if (error) {
    console.warn("Supabase unavailable (archived_docs):", error.message);
    return [];
  }
  return data ?? [];
}

export async function addArchivedDoc(item: {
  id: string;
  title: string;
  type: string;
  archivedDate: string;
  archivedBy: string;
}): Promise<void> {
  const { error } = await supabase.from("archived_docs").insert({
    id: item.id,
    title: item.title,
    type: item.type,
    archived_date: item.archivedDate,
    archived_by: item.archivedBy,
  });
  must(error, "Adding archive entry");
}

export async function deleteArchivedDoc(id: string): Promise<void> {
  const { error } = await supabase.from("archived_docs").delete().eq("id", id);
  if (error) must(error, "Deleting archive entry");
}

const ARCHIVE_TABLES = {
  master_documents: {
    prefix: "arc-md-",
    type: "Master Document",
    category: "master_documents",
  },
  special_orders: {
    prefix: "arc-so-",
    type: "Special Order",
    category: "special_orders",
  },
  daily_journals: {
    prefix: "arc-dj-",
    type: "Daily Journal",
    category: "daily_journals",
  },
  library_items: {
    prefix: "arc-lib-",
    type: "Library Item",
    category: "library_items",
  },
  confidential_docs: {
    prefix: "arc-cd-",
    type: "Classified Document",
    category: "classified_documents",
  },
} as const;
export type ArchivableTable = keyof typeof ARCHIVE_TABLES;

async function driveMove(
  endpoint: "archive" | "restore",
  params: { gdriveFileId: string; poolAccountId: string; category: string }
): Promise<void> {
  const res = await fetch(`/api/gdrive/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(
      json.error ?? `Drive ${endpoint} failed (HTTP ${res.status}).`
    );
  }
}

async function getDriveIds(table: ArchivableTable, docId: string) {
  const { data } = await supabase
    .from(table)
    .select("gdrive_file_id, pool_account_id")
    .eq("id", docId)
    .maybeSingle();
  const row = data as any;
  return row?.gdrive_file_id && row?.pool_account_id
    ? {
        gdriveFileId: row.gdrive_file_id as string,
        poolAccountId: row.pool_account_id as string,
      }
    : null;
}

export async function archiveDocument(opts: {
  table: ArchivableTable;
  docId: string;
  title: string;
  archivedBy: string;
}): Promise<void> {
  const cfg = ARCHIVE_TABLES[opts.table];
  const archiveId = `${cfg.prefix}${opts.docId}`;
  const drive = await getDriveIds(opts.table, opts.docId);

  // Step 1: database (all-or-nothing)
  const { error } = await supabase.rpc("archive_document", {
    p_table: opts.table,
    p_doc_id: opts.docId,
    p_archive_id: archiveId,
    p_title: opts.title,
    p_type: cfg.type,
    p_archived_by: opts.archivedBy,
  });
  if (error) throw new Error(`Could not archive: ${error.message}`);

  // Step 2: Drive. If it fails, undo step 1.
  if (drive) {
    try {
      await driveMove("archive", { ...drive, category: cfg.category });
    } catch (driveErr: any) {
      const { error: undoErr } = await supabase.rpc("restore_document", {
        p_table: opts.table,
        p_doc_id: opts.docId,
        p_archive_id: archiveId,
      });
      if (undoErr) {
        throw new Error(
          `Drive move failed (${driveErr.message}) AND the undo failed (${undoErr.message}). Please check "${opts.title}".`
        );
      }
      throw new Error(
        `Could not move the file to the Drive archive, so nothing was archived. (${driveErr.message})`
      );
    }
  }
}

export async function restoreArchivedDoc(id: string): Promise<void> {
  const entry = Object.entries(ARCHIVE_TABLES).find(([, c]) =>
    id.startsWith(c.prefix)
  );
  if (!entry)
    throw new Error(
      `Unrecognised archive id "${id}". It can't be restored automatically.`
    );
  const table = entry[0] as ArchivableTable;
  const cfg = entry[1];
  const docId = id.slice(cfg.prefix.length);
  const drive = await getDriveIds(table, docId);

  // Step 1: Drive first. If this fails, nothing has changed yet.
  if (drive) await driveMove("restore", { ...drive, category: cfg.category });

  // Step 2: database (all-or-nothing). If it fails, put the file back.
  const { error } = await supabase.rpc("restore_document", {
    p_table: table,
    p_doc_id: docId,
    p_archive_id: id,
  });
  if (error) {
    if (drive) {
      await driveMove("archive", { ...drive, category: cfg.category }).catch(
        (e) =>
          console.error(
            "[restore] could not put file back in archive:",
            e.message
          )
      );
    }
    throw new Error(`Could not restore: ${error.message}`);
  }
}

export async function deleteDriveFile(
  gdriveFileId: string | undefined | null,
  poolAccountId: string | undefined | null
): Promise<void> {
  if (!gdriveFileId || !poolAccountId) return; // old rows with no Drive file

  let res: Response;
  try {
    res = await fetch("/api/gdrive/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gdriveFileId, poolAccountId }),
    });
  } catch {
    throw new Error(
      "Network problem. Nothing was deleted. Check your connection and try again."
    );
  }

  if (res.ok) return; // a file already gone from Drive also returns ok (handled server-side)
  const json = await res.json().catch(() => ({}));
  throw new Error(
    json.error ??
      `Google Drive delete failed (HTTP ${res.status}). Nothing was deleted.`
  );
}

const ATTACHMENT_TABLES: Partial<
  Record<ArchivableTable, { table: string; fk: string }>
> = {
  master_documents: {
    table: "master_document_attachments",
    fk: "master_document_id",
  },
  special_orders: {
    table: "special_order_attachments",
    fk: "special_order_id",
  },
  daily_journals: {
    table: "daily_journal_attachments",
    fk: "daily_journal_id",
  },
  library_items: { table: "library_item_attachments", fk: "library_item_id" },
};

export async function purgeArchivedDoc(archiveId: string): Promise<void> {
  const entry = Object.entries(ARCHIVE_TABLES).find(([, c]) =>
    archiveId.startsWith(c.prefix)
  );
  if (!entry)
    throw new Error(
      `Unrecognised archive id "${archiveId}". It can't be deleted automatically.`
    );
  const table = entry[0] as ArchivableTable;
  const docId = archiveId.slice(entry[1].prefix.length);

  // 1. Collect every Drive file that belongs to this document
  const files: { id: string; pool: string }[] = [];
  const main = await getDriveIds(table, docId);
  if (main) files.push({ id: main.gdriveFileId, pool: main.poolAccountId });

  const att = ATTACHMENT_TABLES[table];
  if (att) {
    const { data, error } = await supabase
      .from(att.table)
      .select("gdrive_file_id, pool_account_id")
      .eq(att.fk, docId);
    if (error)
      throw new Error(`Could not list the attachments: ${error.message}`);
    for (const a of (data ?? []) as any[]) {
      if (a.gdrive_file_id && a.pool_account_id)
        files.push({ id: a.gdrive_file_id, pool: a.pool_account_id });
    }
  }

  // 2. Drive FIRST. Safe to repeat: a file that is already gone counts as deleted.
  const failures: string[] = [];
  for (const f of files) {
    try {
      await deleteDriveFile(f.id, f.pool);
    } catch (e: any) {
      failures.push(e?.message ?? "unknown error");
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${files.length} file(s) could not be deleted from Google Drive, ` +
        `so nothing was removed. ${failures[0]} You can safely try again.`
    );
  }

  // 3. Database LAST (one all-or-nothing step: document + attachments + archive row)
  const { error } = await supabase.rpc("purge_archived_document", {
    p_table: table,
    p_doc_id: docId,
    p_archive_id: archiveId,
  });
  if (error) {
    throw new Error(
      `The Drive files were deleted, but the record could not be removed: ${error.message}. ` +
        `Press Delete again. It is safe to repeat.`
    );
  }
}

/* ════════════════════════════════════════════
   ORG CHART — placeholder
════════════════════════════════════════════ */
export const ORG_CHART: OrgNode = {
  id: "org-root",
  initials: "--",
  rank: "",
  name: "No Data",
  title: "Add personnel to populate the org chart",
  unit: "",
  color: "#94a3b8",
  children: [],
};

/* ════════════════════════════════════════════
   LEGACY EXPORTS
════════════════════════════════════════════ */
export const MASTER_DOCUMENTS: MasterDocument[] = [];
export const SPECIAL_ORDERS: SpecialOrder[] = [];
export const JOURNAL_ENTRIES: JournalEntry[] = [];
export const CONFIDENTIAL_DOCS: ConfidentialDoc[] = [];
export const LIBRARY_ITEMS: LibraryItem[] = [];
export const ACTIVITY_LOGS: ActivityLog[] = [];
