// app/api/gdrive/status/route.ts
import { NextResponse } from "next/server";
import { getAllPoolAccounts, rpcGetPoolSummary } from "@/lib/gdrive-pool/db";
import { getQuickStatus } from "@/lib/gdrive-pool/health";

export const runtime = "nodejs";

/** GET /api/gdrive/status — lightweight pool status from Supabase only (no Drive API) */
export async function GET() {
  try {
    await requireAdminGroup();
    const [quickStatus, accounts, summary] = await Promise.all([
      getQuickStatus(),
      getAllPoolAccounts(),
      rpcGetPoolSummary(),
    ]);

    return NextResponse.json({
      data: {
        quickStatus,
        summary,
        accounts: accounts.map((a: any) => ({
          id: a.id,
          accountEmail: a.account_email,
          ownerUsername: a.owner_username,
          label: a.label,
          status: a.status,
          isActive: a.is_active,
          usageGb: +(a.current_usage_bytes / 1073741824).toFixed(2),
          quotaGb: +(a.quota_bytes / 1073741824).toFixed(2),
          usagePct:
            a.quota_bytes > 0
              ? +((a.current_usage_bytes / a.quota_bytes) * 100).toFixed(1)
              : 0,
          fileCount: a.file_count,
          errorMessage: a.error_message,
          lastHealthCheck: a.last_health_check,
          connectedAt: a.connected_at,
        })),
      },
    });
  } catch (err: any) {
    const authResp = authErrorResponse(err);
    if (authResp) return authResp;
    console.error("[Status API]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// =============================================================================
// app/api/gdrive/disconnect/route.ts
// =============================================================================

// FILE: app/api/gdrive/disconnect/route.ts
import { deactivatePoolAccount, logHealthEvent } from "@/lib/gdrive-pool/db";
import { authErrorResponse, requireAdminGroup } from "@/lib/gdrive-pool/auth";
