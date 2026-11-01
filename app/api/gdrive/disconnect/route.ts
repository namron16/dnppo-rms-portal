// app/api/gdrive/disconnect/route.ts
import { NextResponse } from "next/server";
import { deactivatePoolAccount, logHealthEvent } from "@/lib/gdrive-pool/db";
import { requireAdminGroup } from "@/lib/gdrive-pool/auth";

export const runtime = "nodejs";

/** POST /api/gdrive/disconnect — soft-disconnects a pool account */
export async function POST(request: Request) {
  try {
    await requireAdminGroup();
    const { poolAccountId } = await request.json();

    if (!poolAccountId) {
      return NextResponse.json(
        { error: "poolAccountId is required" },
        { status: 400 }
      );
    }

    const orphanedFiles = await deactivatePoolAccount(poolAccountId);

    await logHealthEvent({
      pool_account_id: poolAccountId,
      event_type: "disconnect",
      status: "warning",
      message: `Account disconnected. ${orphanedFiles} file records now inaccessible.`,
      latency_ms: null,
    });

    return NextResponse.json({
      data: {
        success: true,
        filesOrphaned: orphanedFiles,
        message:
          orphanedFiles > 0
            ? `Account disconnected. ${orphanedFiles} file(s) are inaccessible — they remain in Google Drive.`
            : "Account disconnected successfully.",
      },
    });
  } catch (err: any) {
    console.error("[Disconnect API]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
