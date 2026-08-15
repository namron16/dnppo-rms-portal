// app/admin/system-settings/actions.ts
"use server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function assertSuperAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthenticated");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const admin = getAdminClient();
  const { data: registry } = await admin
    .from("role_registry")
    .select("nav_group")
    .eq("role", profile?.role ?? "")
    .single();

  const isAdmin = registry?.nav_group === "admin" || profile?.role === "admin";
  if (!isAdmin) throw new Error("Forbidden");

  return { supabase, admin, actingRole: profile?.role ?? "admin" };
}

export interface FullSystemSettings {
  session_duration_hours: number;
  min_password_length: number;
  require_uppercase: boolean;
  require_number: boolean;
  require_symbol: boolean;
  lockout_max_attempts: number;
  lockout_duration_minutes: number;
  log_retention_days: number;
  default_backup_retention_days: number;
  org_name: string;
  org_letterhead_text: string;
  updated_at: string;
  updated_by: string;
}

export async function getSystemSettings(): Promise<FullSystemSettings> {
  await assertSuperAdmin();
  const admin = getAdminClient();

  const { data, error } = await admin
    .from("system_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) throw new Error(`Could not load system settings: ${error.message}`);
  return data as FullSystemSettings;
}

export async function saveSystemSettings(input: {
  min_password_length: number;
  require_uppercase: boolean;
  require_number: boolean;
  require_symbol: boolean;
  lockout_max_attempts: number;
  lockout_duration_minutes: number;
  log_retention_days: number;
  default_backup_retention_days: number;
  org_name: string;
  org_letterhead_text: string;
}) {
  const { admin, actingRole } = await assertSuperAdmin();

  const { error } = await admin.rpc("update_system_settings", {
    p_min_password_length: input.min_password_length,
    p_require_uppercase: input.require_uppercase,
    p_require_number: input.require_number,
    p_require_symbol: input.require_symbol,
    p_lockout_max_attempts: input.lockout_max_attempts,
    p_lockout_duration_minutes: input.lockout_duration_minutes,
    p_log_retention_days: input.log_retention_days,
    p_default_backup_retention_days: input.default_backup_retention_days,
    p_org_name: input.org_name,
    p_org_letterhead_text: input.org_letterhead_text,
    p_admin_by: actingRole,
  });

  if (error) throw new Error(`Failed to save settings: ${error.message}`);
  return { success: true };
}

export async function updateSessionDurationSetting(hours: number) {
  const { admin, actingRole } = await assertSuperAdmin();
  const { error } = await admin.rpc("update_session_duration", {
    p_hours: hours,
    p_admin_by: actingRole,
  });
  if (error) throw new Error(error.message);
  return { success: true };
}

/** Emergency: signs out every active session system-wide. */
export async function forceLogoutEveryone(): Promise<{ sessionsCleared: number }> {
  const { admin, actingRole } = await assertSuperAdmin();
  const { data, error } = await admin.rpc("force_logout_all_sessions", {
    p_admin_by: actingRole,
  });
  if (error) throw new Error(`Force logout failed: ${error.message}`);
  return { sessionsCleared: (data as number) ?? 0 };
}

// NOTE: A "default landing page per role" action was intentionally left out.
// role_registry.default_route exists in the schema but is not actually read
// by getDefaultAdminRoute() (lib/adminRouteAccess.ts) or proxy.ts — routing
// is hardcoded by nav_group. Wiring this up would require changes to the
// auth middleware flow, which is out of scope here. See EditRoleModal.tsx
// for the existing (also currently inert) per-role route field.