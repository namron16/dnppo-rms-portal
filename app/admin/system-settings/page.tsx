"use client";
// app/admin/system-settings/page.tsx
// Super-admin only. App-wide configuration:
//   1. Session Duration (existing)
//   2. Security — password rules, account lockout, force-logout-everyone
//   3. Data & Retention — log retention, default backup retention
//   4. Organization Info — office name / letterhead

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getSystemSettings,
  saveSystemSettings,
  updateSessionDurationSetting,
  forceLogoutEveryone,
  type FullSystemSettings,
} from "./actions";

const DURATION_OPTIONS = [
  { label: "4 hours", value: 4 },
  { label: "8 hours", value: 8 },
  { label: "12 hours", value: 12 },
  { label: "24 hours", value: 24 },
  { label: "48 hours", value: 48 },
  { label: "7 days", value: 168 },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Card({
  icon,
  title,
  description,
  children,
}: {
  icon: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
        <span className="text-xl">{icon}</span>
        <div>
          <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 mb-4 last:mb-0">
      <div className="w-52 flex-shrink-0 pt-2">
        <label className="text-[13px] font-medium text-gray-700">{label}</label>
        {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

const inputCls =
  "border border-gray-300 rounded-lg px-3 py-2 text-[13px] text-gray-900 bg-white shadow-sm " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors";

export default function SystemSettingsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [settings, setSettings] = useState<FullSystemSettings | null>(null);
  const [form, setForm] = useState<FullSystemSettings | null>(null);
  const [sessionHours, setSessionHours] = useState(24);

  const [isFetching, setIsFetching] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isForcingLogout, setIsForcingLogout] = useState(false);
  const [confirmForceLogout, setConfirmForceLogout] = useState(false);
  const [banner, setBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Guard: only nav_group='admin' accounts may see this page
  useEffect(() => {
    if (user && user?.nav_group !== "admin") {
      router.replace("/admin/log-history");
    }
  }, [user, router]);

  useEffect(() => {
    async function load() {
      setIsFetching(true);
      try {
        const s = await getSystemSettings();
        setSettings(s);
        setForm(s);
        setSessionHours(s.session_duration_hours);
      } catch (e: unknown) {
        setBanner({
          type: "error",
          text: e instanceof Error ? e.message : "Failed to load settings.",
        });
      } finally {
        setIsFetching(false);
      }
    }
    void load();
  }, []);

  function set<K extends keyof FullSystemSettings>(
    key: K,
    value: FullSystemSettings[K]
  ) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  const hasChanges =
    !!form &&
    !!settings &&
    JSON.stringify({ ...form, updated_at: "", session_duration_hours: 0 }) !==
      JSON.stringify({
        ...settings,
        updated_at: "",
        session_duration_hours: 0,
      });

  const sessionChanged = sessionHours !== settings?.session_duration_hours;

  async function handleSaveAll() {
    if (!form) return;
    setIsSaving(true);
    setBanner(null);
    try {
      if (sessionChanged) {
        await updateSessionDurationSetting(sessionHours);
      }
      await saveSystemSettings({
        min_password_length: form.min_password_length,
        require_uppercase: form.require_uppercase,
        require_number: form.require_number,
        require_symbol: form.require_symbol,
        lockout_max_attempts: form.lockout_max_attempts,
        lockout_duration_minutes: form.lockout_duration_minutes,
        log_retention_days: form.log_retention_days,
        default_backup_retention_days: form.default_backup_retention_days,
        org_name: form.org_name,
        org_letterhead_text: form.org_letterhead_text,
      });

      const fresh = await getSystemSettings();
      setSettings(fresh);
      setForm(fresh);
      setSessionHours(fresh.session_duration_hours);
      setBanner({
        type: "success",
        text: "Settings saved. Changes apply immediately.",
      });
    } catch (e: unknown) {
      setBanner({
        type: "error",
        text: e instanceof Error ? e.message : "Save failed.",
      });
    } finally {
      setIsSaving(false);
      setTimeout(() => setBanner(null), 5000);
    }
  }

  async function handleForceLogout() {
    setIsForcingLogout(true);
    try {
      const { sessionsCleared } = await forceLogoutEveryone();
      setBanner({
        type: "success",
        text: `Force-logged-out ${sessionsCleared} active session(s).`,
      });
    } catch (e: unknown) {
      setBanner({
        type: "error",
        text: e instanceof Error ? e.message : "Force logout failed.",
      });
    } finally {
      setIsForcingLogout(false);
      setConfirmForceLogout(false);
      setTimeout(() => setBanner(null), 5000);
    }
  }

  if (user?.nav_group !== "admin") return null;

  return (
    <div className="p-6 max-w-3xl mx-auto pb-20">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          System Settings
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          App-wide configuration. Changes take effect immediately for all users.
        </p>
      </div>

      {banner && (
        <div
          className={`rounded-lg px-4 py-3 mb-5 text-[13px] flex items-center gap-2 ${
            banner.type === "success"
              ? "bg-green-50 border border-green-200 text-green-700"
              : "bg-red-50 border border-red-200 text-red-700"
          }`}
        >
          <span>{banner.type === "success" ? "✅" : "❌"}</span>
          {banner.text}
        </div>
      )}

      {isFetching || !form ? (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-10 justify-center">
          <span className="animate-spin">⏳</span> Loading current settings…
        </div>
      ) : (
        <>
          {/* ── Session Duration ── */}
          <Card
            icon="🔐"
            title="Session Duration"
            description="How long a user stays logged in before automatic sign-out."
          >
            <Field label="Max session length">
              <select
                value={sessionHours}
                onChange={(e) => setSessionHours(Number(e.target.value))}
                className={inputCls}
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
          </Card>

          {/* ── Security ── */}
          <Card
            icon="🔒"
            title="Security"
            description="Password rules, account lockout, and emergency sign-out."
          >
            <Field label="Minimum password length" hint="8–64 characters">
              <input
                type="number"
                min={8}
                max={64}
                value={form.min_password_length}
                onChange={(e) =>
                  set("min_password_length", Number(e.target.value))
                }
                className={`${inputCls} w-28`}
              />
            </Field>
            <Field label="Complexity requirements">
              <div className="flex flex-col gap-2">
                {(
                  [
                    [
                      "require_uppercase",
                      "Require at least one uppercase letter",
                    ],
                    ["require_number", "Require at least one number"],
                    ["require_symbol", "Require at least one symbol"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={form[key]}
                      onChange={(e) => set(key, e.target.checked)}
                      className="w-4 h-4 rounded"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </Field>
            <Field
              label="Lockout after"
              hint="Failed attempts before an account is temporarily locked"
            >
              <input
                type="number"
                min={3}
                max={20}
                value={form.lockout_max_attempts}
                onChange={(e) =>
                  set("lockout_max_attempts", Number(e.target.value))
                }
                className={`${inputCls} w-28`}
              />{" "}
              <span className="text-[12px] text-gray-500 ml-2">attempts</span>
            </Field>
            <Field
              label="Lockout duration"
              hint="How long the account stays locked"
            >
              <input
                type="number"
                min={1}
                max={1440}
                value={form.lockout_duration_minutes}
                onChange={(e) =>
                  set("lockout_duration_minutes", Number(e.target.value))
                }
                className={`${inputCls} w-28`}
              />{" "}
              <span className="text-[12px] text-gray-500 ml-2">minutes</span>
            </Field>

            <div className="border-t border-gray-100 mt-5 pt-5">
              <Field
                label="Force logout everyone"
                hint="Emergency use only — e.g. a leaked password."
              >
                {!confirmForceLogout ? (
                  <button
                    onClick={() => setConfirmForceLogout(true)}
                    className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition"
                  >
                    🚨 Force Logout Everyone
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-red-700 font-medium">
                      Sign out ALL active sessions right now?
                    </span>
                    <button
                      onClick={handleForceLogout}
                      disabled={isForcingLogout}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                    >
                      {isForcingLogout
                        ? "Signing out…"
                        : "Yes, sign everyone out"}
                    </button>
                    <button
                      onClick={() => setConfirmForceLogout(false)}
                      disabled={isForcingLogout}
                      className="px-3 py-1.5 rounded-lg text-[12px] border border-gray-200 text-gray-600 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </Field>
            </div>
          </Card>

          {/* ── Data & Retention ── */}
          <Card
            icon="🗄️"
            title="Data & Retention"
            description="How long logs and backups are kept before automatic cleanup."
          >
            <Field
              label="Log retention period"
              hint="Activity logs older than this are deleted nightly."
            >
              <input
                type="number"
                min={7}
                max={3650}
                value={form.log_retention_days}
                onChange={(e) =>
                  set("log_retention_days", Number(e.target.value))
                }
                className={`${inputCls} w-28`}
              />{" "}
              <span className="text-[12px] text-gray-500 ml-2">days</span>
            </Field>
            <Field
              label="Default backup retention"
              hint="Used as the default when a module's backup schedule doesn't override it."
            >
              <input
                type="number"
                min={7}
                max={3650}
                value={form.default_backup_retention_days}
                onChange={(e) =>
                  set("default_backup_retention_days", Number(e.target.value))
                }
                className={`${inputCls} w-28`}
              />{" "}
              <span className="text-[12px] text-gray-500 ml-2">days</span>
            </Field>
          </Card>

          {/* ── Organization Info ── */}
          <Card
            icon="🏢"
            title="Organization Info"
            description="Used on letterheads and headers of generated documents."
          >
            <Field label="Office name">
              <input
                type="text"
                value={form.org_name}
                onChange={(e) => set("org_name", e.target.value)}
                className={`${inputCls} w-full`}
                placeholder="e.g. Davao Norte Provincial Police Office"
              />
            </Field>
            <Field
              label="Letterhead text"
              hint="Shown under the office name on generated documents."
            >
              <textarea
                value={form.org_letterhead_text}
                onChange={(e) => set("org_letterhead_text", e.target.value)}
                rows={3}
                className={`${inputCls} w-full`}
                placeholder="e.g. Republic of the Philippines, Department of the Interior and Local Government..."
              />
            </Field>
          </Card>

          {/* ── Save bar ── */}
          {settings && (
            <p className="text-[11px] text-gray-400 mb-4">
              Last updated {fmtDate(settings.updated_at)} by{" "}
              <strong>{settings.updated_by}</strong>
            </p>
          )}
          <div className="sticky bottom-4 flex items-center gap-3 bg-white border border-gray-200 rounded-xl shadow-md px-5 py-3">
            <button
              onClick={handleSaveAll}
              disabled={isSaving || !(hasChanges || sessionChanged)}
              className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {isSaving ? "Saving…" : "Save Changes"}
            </button>
            {!(hasChanges || sessionChanged) && (
              <span className="text-[12px] text-gray-400">
                No changes to save
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
