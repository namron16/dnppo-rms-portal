// app/api/gdrive/records/route.ts
// Query the Supabase records table — file metadata cache for all Drive uploads.

import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/gdrive-pool/db";
import type { DocumentCategory } from "@/lib/gdrive-pool/types";
import { requireAdminGroup } from "@/lib/gdrive-pool/auth";

export const runtime = "nodejs";

/**
 * GET /api/gdrive/records
 *
 * Query params:
 *   category    — filter by document category
 *   entityType  — filter by entity type (e.g. 'master_document')
 *   entityId    — filter by entity ID
 *   uploadedBy  — filter by uploader role
 *   accessible  — 'true' | 'false' | undefined (all)
 *   limit       — default 50, max 200
 *   offset      — default 0
 */
export async function GET(request: Request) {
  try {
    await requireAdminGroup();
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") as DocumentCategory | null;
    const entityType = searchParams.get("entityType");
    const entityId = searchParams.get("entityId");
    const uploadedBy = searchParams.get("uploadedBy");
    const accessible = searchParams.get("accessible");
    const limit = Math.min(
      200,
      parseInt(searchParams.get("limit") ?? "50", 10)
    );
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));

    const db = getServiceClient();

    let query = db
      .from("records")
      .select(
        `
        id, file_name, original_name, gdrive_file_id, mime_type,
        pool_account_id, category, size_bytes,
        drive_url, thumbnail_url, download_url,
        entity_type, entity_id, uploaded_by,
        is_accessible, last_synced, created_at,
        storage_pool!inner(account_email, status)
      `,
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) query = query.eq("category", category);
    if (entityType) query = query.eq("entity_type", entityType);
    if (entityId) query = query.eq("entity_id", entityId);
    if (uploadedBy) query = query.eq("uploaded_by", uploadedBy);
    if (accessible === "true") query = query.eq("is_accessible", true);
    if (accessible === "false") query = query.eq("is_accessible", false);

    const { data, error, count } = await query;

    if (error) {
      console.error("[Records API GET]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        records: data ?? [],
        total: count ?? 0,
        limit,
        offset,
      },
    });
  } catch (err: any) {
    console.error("[Records API GET]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/gdrive/records/sync
 * Re-syncs a record's Drive metadata (size, URLs) from the Drive API.
 * Useful after a file is modified directly in Drive.
 */
export async function POST(request: Request) {
  try {
    await requireAdminGroup();
    const { recordId } = await request.json();
    if (!recordId) {
      return NextResponse.json(
        { error: "recordId is required" },
        { status: 400 }
      );
    }

    const db = getServiceClient();

    const { data: record, error: fetchErr } = await db
      .from("records")
      .select("gdrive_file_id, pool_account_id")
      .eq("id", recordId)
      .maybeSingle();

    if (fetchErr || !record) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    const { getDriveClient, getFileMetadata } = await import(
      "@/lib/gdrive-pool/drive-client"
    );
    const drive = await getDriveClient(record.pool_account_id);
    const metadata = await getFileMetadata(drive, record.gdrive_file_id);

    if (!metadata) {
      // File gone from Drive — mark inaccessible
      await db
        .from("records")
        .update({ is_accessible: false, last_synced: new Date().toISOString() })
        .eq("id", recordId);

      return NextResponse.json({
        data: { recordId, accessible: false, synced: true },
      });
    }

    // Update record with fresh metadata
    await db
      .from("records")
      .update({
        file_name: metadata.name,
        size_bytes: parseInt(metadata.size ?? "0", 10),
        drive_url: metadata.webViewLink ?? null,
        download_url: metadata.webContentLink ?? null,
        thumbnail_url: metadata.thumbnailLink ?? null,
        is_accessible: true,
        last_synced: new Date().toISOString(),
      })
      .eq("id", recordId);

    return NextResponse.json({
      data: { recordId, accessible: true, synced: true },
    });
  } catch (err: any) {
    console.error("[Records Sync API]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
