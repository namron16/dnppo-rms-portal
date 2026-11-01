// lib/gdrive-pool/auth.ts
// Shared login + permission checks for every /api/gdrive/* route.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient, getPoolAccountFull } from "./db";

export class ApiAuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiAuthError";
  }
}

export interface Caller {
  id: string;
  role: string;
  isAdminGroup: boolean;
  canUpload: boolean;
}

/** Must be signed in, with an active account. Returns who is calling. */
export async function requireCaller(): Promise<Caller> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ApiAuthError(401, "Please sign in again.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();
  if (!profile) throw new ApiAuthError(403, "Account profile not found.");
  if (profile.is_active === false)
    throw new ApiAuthError(403, "This account is disabled.");

  const { data: reg } = await getServiceClient()
    .from("role_registry")
    .select("nav_group, can_upload")
    .eq("role", profile.role)
    .maybeSingle();

  return {
    id: user.id,
    role: profile.role,
    isAdminGroup: reg?.nav_group === "admin" || profile.role === "admin",
    canUpload: reg?.can_upload ?? true,
  };
}

/** Signed in AND in the administrator group. */
export async function requireAdminGroup(): Promise<Caller> {
  const caller = await requireCaller();
  if (!caller.isAdminGroup)
    throw new ApiAuthError(403, "Administrator access required.");
  return caller;
}

/** The Drive account must belong to the caller (admins may touch any). */
export async function requirePoolOwner(
  caller: Caller,
  poolAccountId: string
): Promise<void> {
  if (caller.isAdminGroup) return;
  let owner: string | null = null;
  try {
    owner = (await getPoolAccountFull(poolAccountId)).owner_username;
  } catch {
    /* not found */
  }
  if (!owner) throw new ApiAuthError(404, "Storage account not found.");
  if (owner !== caller.role)
    throw new ApiAuthError(403, "That file is in another user's Drive.");
}

/** Use at the top of a route's catch block: returns a response for auth errors, else null. */
export function authErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof ApiAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return null;
}
