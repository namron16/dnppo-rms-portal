// lib/forwarding.ts
// Client helpers for forwarding documents. Only metadata is sent to /api/forward;
// the server looks up the real Drive file itself.

export type DocumentType =
  | "master_document"
  | "admin_order"
  | "daily_journal"
  | "library";

export interface ForwardAttachmentPayload {
  originalAttachmentId?: string;
  parentAttachmentId?: string;
  depth: number;
  title: string;
  fileName?: string;
  fileSizeBytes?: number;
  mimeType?: string;
  gdriveFileId: string;
  gdriveUrl: string;
  poolAccountId: string;
}

export interface ForwardPayload {
  recipients: string[];
  originalDocId: string;
  documentType: DocumentType;
  title: string;
  notes?: string;
  gdriveFileId: string;
  gdriveUrl: string;
  poolAccountId: string;
  fileName?: string;
  fileSizeBytes?: number;
  mimeType?: string;
  attachments: ForwardAttachmentPayload[];
}

export interface ForwardResult {
  success: boolean;
  count: number;
  errors: { recipient: string; error: string }[];
  skipped?: string[];
}

export interface AttachmentNode {
  id: string;
  title: string;
  file_name: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  gdrive_file_id: string;
  gdrive_url: string;
  pool_account_id: string;
  parent_id: string | null;
  depth: number;
  children: AttachmentNode[];
}

export async function forwardDocument(
  payload: ForwardPayload
): Promise<ForwardResult> {
  const res = await fetch("/api/forward", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let json: any = {};
  try {
    json = await res.json();
  } catch {
    /* server sent a non-JSON error page */
  }

  if (!res.ok) {
    return {
      success: false,
      count: 0,
      skipped: json.skipped ?? [],
      errors: [
        {
          recipient: "all",
          error: json.error ?? `Request failed (HTTP ${res.status})`,
        },
      ],
    };
  }
  return {
    success: !!json.success,
    count: json.count ?? 0,
    skipped: json.skipped ?? [],
    errors: json.errors ?? [],
  };
}

export function flattenAttachmentsForForward(
  docId: string,
  attachmentsMap: Map<string, any[]>
): ForwardAttachmentPayload[] {
  const flat: ForwardAttachmentPayload[] = [];

  function walk(
    parentId: string,
    parentAttachmentId: string | undefined,
    depth: number
  ) {
    const children = attachmentsMap.get(parentId) ?? [];
    for (const att of children) {
      flat.push({
        originalAttachmentId: att.id,
        parentAttachmentId,
        depth,
        title: att.title ?? att.file_name ?? "Attachment",
        fileName: att.file_name,
        fileSizeBytes: att.file_size_bytes,
        mimeType: att.mime_type,
        gdriveFileId: att.gdrive_file_id,
        gdriveUrl: att.gdrive_url,
        poolAccountId: att.pool_account_id,
      });
      walk(att.id, att.id, depth + 1);
    }
  }

  walk(docId, undefined, 0);
  return flat;
}

export function buildAttachmentTree(
  attachments: any[],
  parentId: string | null = null
): any[] {
  return attachments
    .filter((a) => (a.parent_attachment_id ?? null) === parentId)
    .map((a) => ({
      ...a,
      children: buildAttachmentTree(
        attachments,
        a.original_attachment_id ?? a.id
      ),
    }));
}
