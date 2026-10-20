// lib/activeRoles.ts
// One shared, cached copy of the active account list (from get_active_roles()).
// The database already returns it in the correct order, so never re-sort it here.
// Used by ForwardDocumentModal and DPDAFilterBar (instead of hardcoded lists).

import { createClient } from "@/lib/supabase/client";

export interface ActiveRole {
  role: string;
  display_name: string;
  title: string;
  nav_group: string;
  can_upload: boolean;
  is_viewer_only: boolean;
  sort_order: number;
}

const TTL_MS = 60_000;
let cache: { data: ActiveRole[]; fetchedAt: number } | null = null;
let inflight: Promise<ActiveRole[]> | null = null;

/** Last known list (any age) or null. Handy for the first paint. */
export function peekActiveRoles(): ActiveRole[] | null {
  return cache?.data ?? null;
}

/** Returns the list; hits the database only if the copy is older than 60s. */
export async function fetchActiveRoles(): Promise<ActiveRole[]> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = (async () => {
    const { data, error } = await createClient().rpc("get_active_roles");
    if (error) throw error;
    const roles = (data ?? []) as ActiveRole[];
    cache = { data: roles, fetchedAt: Date.now() };
    return roles;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Call after creating / deleting / editing an account. */
export function invalidateActiveRolesCache() {
  cache = null;
}
