import { NextResponse } from "next/server";
import { requireAdminGroup } from "@/lib/gdrive-pool/auth";
import { getAuthorizationUrl } from "@/lib/gdrive-pool/drive-client";

export async function GET(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    await requireAdminGroup();
  } catch {
    return NextResponse.redirect(
      `${appUrl}/admin/gdrive?error=Administrator%20access%20required`
    );
  }

  const username = new URL(request.url).searchParams.get("username");
  if (!username) {
    return NextResponse.json(
      { error: "username query param is required" },
      { status: 400 }
    );
  }

  const nonce = crypto.randomUUID();
  const authUrl = getAuthorizationUrl(
    username,
    `${appUrl}/api/gdrive/callback`,
    nonce
  );

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("gdrive_oauth_nonce", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/api/gdrive",
  });
  return res;
}
