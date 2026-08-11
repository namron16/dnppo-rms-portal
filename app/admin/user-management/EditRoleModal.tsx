"use client";
import { useEffect, useState } from "react";
import { getRoleRegistryRow, updateRolePermissions } from "./actions";

interface Props {
  role: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditRoleModal({ role, onClose, onSuccess }: Props) {
  const [form, setForm] = useState({
    display_name: "",
    title: "",
    // FIX: nav_group now supports 'pd' — Provincial Director
    nav_group: "documents" as "documents" | "admin" | "dpda-dpdo" | "pd",
    can_upload: true,
    is_viewer_only: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getRoleRegistryRow(role)
      .then((row) => {
        setForm({
          display_name: row.display_name,
          title: row.title,
          nav_group: row.nav_group as any,
          can_upload: row.can_upload,
          is_viewer_only: row.is_viewer_only,
        });
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to load role.")
      )
      .finally(() => setLoading(false));
  }, [role]);

  const set = (key: keyof typeof form, value: unknown) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSave() {
    setError("");
    if (!form.display_name.trim()) {
      setError("Display name is required.");
      return;
    }
    setSaving(true);
    try {
      await updateRolePermissions({ role, ...form });
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update role.");
    } finally {
      setSaving(false);
    }
  }

  const labelCls = "block text-xs font-semibold text-slate-700 mb-1";
  const inputCls =
    "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300";

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">
            ✏️ Edit Role: {role}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">
            Loading role settings…
          </div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  ❌ {error}
                </div>
              )}

              <div>
                <label className={labelCls}>Display Name *</label>
                <input
                  type="text"
                  value={form.display_name}
                  onChange={(e) => set("display_name", e.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Navigation Group</label>
                <select
                  value={form.nav_group}
                  onChange={(e) => set("nav_group", e.target.value as any)}
                  className={inputCls}
                >
                  <option value="documents">Documents (P1–P10, etc.)</option>
                  <option value="dpda-dpdo">Deputy (DPDA / DPDO)</option>
                  <option value="pd">PD (Provincial Director)</option>
                  <option value="admin">Admin-only</option>
                </select>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.can_upload}
                    onChange={(e) => set("can_upload", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  Can upload documents
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_viewer_only}
                    onChange={(e) => set("is_viewer_only", e.target.checked)}
                    className="w-4 h-4 rounded"
                  />
                  Viewer-only nav (no 201 Personnel Files tab)
                </label>
              </div>

              <p className="text-[11px] text-slate-400 pt-1">
                Upload permission takes effect on next login. Nav group and
                viewer-only take effect after the user's session refreshes their
                JWT (also next login).
              </p>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 flex items-center gap-2"
              >
                {saving && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
