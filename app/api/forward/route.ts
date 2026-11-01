// app/api/forward/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/gdrive-pool/db";
import { logForwardDocument, setCurrentLogger } from "@/lib/adminLogger";
import { AdminRole } from "@/lib/auth";

const DOC_TABLE: Record<string, string> = {
  master_document: "master_documents",
  admin_order: "special_orders",
  daily_journal: "daily_journals",
  library: "library_items",
};
const ATT_TABLE: Record<string, string> = {
  master_document: "master_document_attachments",
  admin_order: "special_order_attachments",
  daily_journal: "daily_journal_attachments",
  library: "library_item_attachments",
};
const ATT_FK: Record<string, string> = {
  master_document: "master_document_id",
  admin_order: "special_order_id",
  daily_journal: "daily_journal_id",
  library: "library_item_id",
};
const TITLE_COL: Record<string, string> = {
  master_document: "title",
  admin_order: "subject",
  daily_journal: "title",
  library: "title",
};

const hasValue = (s: unknown): s is string =>
  typeof s === "string" && s.trim().length > 0;

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (!user || authError)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile)
    return NextResponse.json({ error: "Profile not found" }, { status: 403 });
  setCurrentLogger(profile.role as AdminRole, user.id);

  // The browser may send gdrive*, fileName, mimeType, title, attachments.
  // They are IGNORED on purpose. Only these three things are used:
  const body = await req.json().catch(() => null);
  const originalDocId = String(body?.originalDocId ?? "");
  const documentType = String(body?.documentType ?? "");
  const notes: string | null =
    typeof body?.notes === "string" ? body.notes : null;
  const recipients: string[] = Array.isArray(body?.recipients)
    ? [...new Set<string>(body.recipients.map(String))]
    : [];

  const docTable = DOC_TABLE[documentType];
  if (!docTable || !originalDocId)
    return NextResponse.json({ error: "Invalid document." }, { status: 400 });
  if (recipients.length === 0)
    return NextResponse.json(
      { error: "No recipients provided" },
      { status: 400 }
    );

  // Is this role allowed to forward at all?
  const { data: reg } = await supabase
    .from("role_registry")
    .select("can_upload")
    .eq("role", profile.role)
    .maybeSingle();
  if (reg?.can_upload === false)
    return NextResponse.json(
      { error: "Your role cannot forward documents." },
      { status: 403 }
    );

  // Recipients must be real, active roles (and not yourself)
  const { data: activeRoles } = await supabase.rpc("get_active_roles");
  const valid = new Set<string>((activeRoles ?? []).map((r: any) => r.role));
  const targets = recipients.filter((r) => r !== profile.role && valid.has(r));
  if (targets.length === 0)
    return NextResponse.json(
      { error: "No valid recipients." },
      { status: 400 }
    );

  // ── Look the file up ON THE SERVER. Try the document, then attachments. ────
  const titleCol = TITLE_COL[documentType];
  const cols = `id, ${titleCol}, uploaded_by, gdrive_file_id, gdrive_url, pool_account_id, file_name, file_size_bytes, mime_type`;

  let source: any = null;
  let rootId = originalDocId;
  let baseAttId: string | null = null;

  const { data: doc } = await supabase
    .from(docTable)
    .select(cols)
    .eq("id", originalDocId)
    .maybeSingle();
  const d = doc as any;
  if (d) {
    source = { title: d[titleCol], uploadedBy: d.uploaded_by, ...pickFile(d) };
  } else {
    const { data: attRow } = await supabase
      .from(ATT_TABLE[documentType])
      .select("*")
      .eq("id", originalDocId)
      .maybeSingle();
    const att = attRow as any;
    if (att) {
      rootId = att[ATT_FK[documentType]];
      baseAttId = att.id;
      const { data: rootRow } = await supabase
        .from(docTable)
        .select("id, uploaded_by")
        .eq("id", rootId)
        .maybeSingle();
      const root = rootRow as any;
      if (root)
        source = {
          title: att.title || att.file_name || "Attachment",
          uploadedBy: root.uploaded_by,
          ...pickFile(att),
        };
    }
  }

  if (!source)
    return NextResponse.json(
      { error: "Document not found, or you do not have access to it." },
      { status: 404 }
    );

  // You may only forward what you uploaded (old rows with no owner are allowed)
  if (source.uploadedBy && source.uploadedBy !== profile.role) {
    return NextResponse.json(
      { error: "You can only forward documents you uploaded." },
      { status: 403 }
    );
  }
  if (!hasValue(source.gdrive_file_id) || !hasValue(source.pool_account_id)) {
    return NextResponse.json(
      {
        error:
          "This document has no Google Drive file linked. Delete and re-upload it, then forward again.",
        code: "MISSING_DRIVE_METADATA",
      },
      { status: 422 }
    );
  }

  // ── Build the attachment list from the database (not from the browser) ─────
  const { data: allAtts } = await supabase
    .from(ATT_TABLE[documentType])
    .select("*")
    .eq(ATT_FK[documentType], rootId)
    .order("created_at", { ascending: true });

  const byParent = new Map<string | null, any[]>();
  for (const a of (allAtts ?? []) as any[]) {
    const key = a.parent_id ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), a]);
  }
  const attachments: Array<{ row: any; depth: number; parent: string | null }> =
    [];
  const walk = (parentKey: string | null, depth: number) => {
    if (depth > 20) return;
    for (const a of byParent.get(parentKey) ?? []) {
      attachments.push({
        row: a,
        depth,
        parent: depth === 0 ? null : parentKey,
      });
      walk(a.id, depth + 1);
    }
  };
  walk(baseAttId, 0);

  // ── Skip recipients who already have this exact file waiting (accidental double-forward)
  const { data: existing } = await supabase
    .from("forwarded_documents")
    .select("recipient_role")
    .eq("sender_role", profile.role)
    .eq("original_doc_id", originalDocId)
    .eq("status", "pending")
    .eq("dpda_status", "pending")
    .in("recipient_role", targets);
  const already = new Set<string>(
    (existing ?? []).map((r: any) => r.recipient_role)
  );
  const toSend = targets.filter((r) => !already.has(r));

  // ── Insert with the SERVICE client (browser can no longer insert these rows)
  const db = getServiceClient();
  const results: { recipient: string; id: string }[] = [];
  const errors: { recipient: string; error: string }[] = [];

  for (const recipientRole of toSend) {
    try {
      const { data: fwdDoc, error: insertError } = await db
        .from("forwarded_documents")
        .insert({
          sender_role: profile.role,
          recipient_role: recipientRole,
          original_doc_id: originalDocId,
          document_type: documentType,
          title: source.title,
          notes,
          gdrive_file_id: source.gdrive_file_id,
          gdrive_url:
            source.gdrive_url ??
            `https://drive.google.com/file/d/${source.gdrive_file_id}/view`,
          pool_account_id: source.pool_account_id,
          file_name: source.file_name ?? null,
          file_size_bytes: source.file_size_bytes ?? null,
          mime_type: source.mime_type ?? null,
          status: "pending",
        })
        .select()
        .single();

      if (insertError || !fwdDoc) {
        errors.push({
          recipient: recipientRole,
          error: insertError?.message ?? "Insert failed",
        });
        continue;
      }

      if (attachments.length > 0) {
        const rows = attachments.map(({ row: a, depth, parent }) => ({
          forwarded_document_id: fwdDoc.id,
          original_attachment_id: a.id,
          parent_attachment_id: parent,
          depth,
          title: a.title || a.file_name || "Attachment",
          file_name: a.file_name ?? null,
          file_size_bytes: a.file_size_bytes ?? null,
          mime_type: a.mime_type ?? null,
          gdrive_file_id: a.gdrive_file_id,
          gdrive_url: a.gdrive_url,
          pool_account_id: a.pool_account_id,
        }));
        const { error: attError } = await db
          .from("forwarded_attachments")
          .insert(rows);
        if (attError) {
          await db.from("forwarded_documents").delete().eq("id", fwdDoc.id); // UNDO: all or nothing
          errors.push({
            recipient: recipientRole,
            error: `Attachments failed, nothing was sent: ${attError.message}`,
          });
          continue;
        }
      }

      await logForwardDocument(source.title, recipientRole);
      results.push({ recipient: recipientRole, id: fwdDoc.id });
    } catch (err: any) {
      errors.push({
        recipient: recipientRole,
        error: err?.message ?? "Unknown error",
      });
    }
  }

  if (toSend.length === 0) {
    return NextResponse.json(
      {
        success: false,
        count: 0,
        results: [],
        errors: [],
        skipped: [...already],
        error: `Already waiting in the inbox of: ${[...already].join(
          ", "
        )}. Nothing was sent again.`,
      },
      { status: 409 }
    );
  }

  return NextResponse.json(
    {
      success: results.length > 0,
      count: results.length,
      results,
      errors,
      skipped: [...already],
      ...(results.length === 0
        ? { error: errors[0]?.error ?? "Forward failed." }
        : {}),
    },
    { status: results.length > 0 ? 201 : 500 }
  );
}

function pickFile(r: any) {
  return {
    gdrive_file_id: r.gdrive_file_id,
    gdrive_url: r.gdrive_url,
    pool_account_id: r.pool_account_id,
    file_name: r.file_name,
    file_size_bytes: r.file_size_bytes,
    mime_type: r.mime_type,
  };
}
