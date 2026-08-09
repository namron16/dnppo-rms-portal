// app/api/documents/route.ts
// Master Documents REST API.
// GET  — list / filter documents (from DB)
// POST — create a new document record + upload file to Drive pool

import { NextResponse } from "next/server";
import { MASTER_DOCUMENTS } from "@/lib/data";
import { uploadMasterDocument } from "@/lib/gdrive-pool/migrate-modal";

// FIX 5.2 (master-document-audit.md): per-user/session data must never be
// cached by Next.js's Data Cache — make that explicit instead of relying on
// the implicit default (which can change between Next.js versions).
export const dynamic = "force-dynamic";

/** GET /api/documents — list all master documents */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const level = searchParams.get("level");
  const search = searchParams.get("search")?.toLowerCase();

  let docs = MASTER_DOCUMENTS.flat();

  if (level && level !== "all") {
    docs = docs.filter((d) => d.level === level.toUpperCase());
  }

  if (search) {
    docs = docs.filter((d) => d.title.toLowerCase().includes(search));
  }

  return NextResponse.json({ data: docs, total: docs.length });
}

/** POST /api/documents — create a new document + upload attachment to Drive */
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    // ── Multipart upload (file + metadata) ────────────────────────────────
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const title = formData.get("title") as string | null;
      const level = formData.get("level") as string | null;
      const date = formData.get("date") as string | null;
      const type = formData.get("type") as string | null;
      const tag = formData.get("tag") as string | null;
      const uploadedBy = formData.get("uploadedBy") as string | null;

      if (!title || !level || !date) {
        return NextResponse.json(
          { error: "Missing required fields: title, level, date" },
          { status: 400 }
        );
      }

      const newDocId = `md-${Date.now()}`;

      const newDoc: Record<string, any> = {
        id: newDocId,
        title,
        level: level.toUpperCase(),
        date,
        type: type ?? "PDF",
        size: "0 MB",
        tag: tag ?? "COMPLIANCE",
      };

      if (file && uploadedBy) {
        if (
          !file.type.startsWith("image/") &&
          file.type !== "application/pdf"
        ) {
          return NextResponse.json(
            { error: `File type not allowed: ${file.type}` },
            { status: 415 }
          );
        }

        if (file.size > 50 * 1024 * 1024) {
          return NextResponse.json(
            { error: "File exceeds 50 MB limit." },
            { status: 413 }
          );
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        const driveResult = await uploadMasterDocument({
          file: buffer,
          fileName: file.name,
          mimeType: file.type,
          docId: newDocId,
          uploadedBy,
          fileSizeBytes: file.size,
        });

        newDoc.fileUrl = driveResult.fileUrl;
        newDoc.downloadUrl = driveResult.downloadUrl;
        newDoc.previewUrl = driveResult.previewUrl;
        newDoc.gdriveFileId = driveResult.gdriveFileId;
        newDoc.poolAccountId = driveResult.poolAccountId;
        newDoc.recordId = driveResult.recordId;
        newDoc.size = `${(driveResult.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
      }

      return NextResponse.json({ data: newDoc }, { status: 201 });
    }

    // ── JSON body (metadata only, no file) ────────────────────────────────
    const body = await request.json();

    if (!body.title || !body.level || !body.date) {
      return NextResponse.json(
        { error: "Missing required fields: title, level, date" },
        { status: 400 }
      );
    }

    const newDoc = {
      id: `md-${Date.now()}`,
      title: body.title,
      level: body.level,
      date: body.date,
      type: body.type ?? "PDF",
      size: body.size ?? "0 MB",
      tag: body.tag ?? "COMPLIANCE",
    };

    return NextResponse.json({ data: newDoc }, { status: 201 });
  } catch (err: any) {
    console.error("[Documents API POST]", err.message);
    return NextResponse.json(
      { error: err.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
