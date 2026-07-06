"use client";
// components/ui/Toast.tsx
// ─────────────────────────────────────────────
// Lightweight toast notification system.
// Uses React context so any component can trigger toasts.
//
// Setup: wrap app in <ToastProvider> (already done in app/layout.tsx)
//
// Usage anywhere:
//   const { toast } = useToast()
//   toast.success('Document archived successfully.')
//   toast.error('Failed to save changes.')
//   toast.info('Changes saved.')

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    info: (msg: string) => void;
    warning: (msg: string) => void;
  };
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastType, string> = {
  success: "✅",
  error: "❌",
  info: "ℹ️",
  warning: "⚠️",
};

const COLORS: Record<ToastType, string> = {
  success: "bg-emerald-50 border-emerald-200 text-emerald-800",
  error: "bg-red-50 border-red-200 text-red-800",
  info: "bg-blue-50 border-blue-200 text-blue-800",
  warning: "bg-amber-50 border-amber-200 text-amber-800",
};

function ToastItem({
  item,
  onRemove,
}: {
  item: ToastItem;
  onRemove: () => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(onRemove, 3500);
    return () => clearTimeout(timerRef.current);
  }, [onRemove]);

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-md text-sm font-medium animate-fade-up min-w-[260px] max-w-sm",
        COLORS[item.type]
      )}
    >
      <span className="text-base flex-shrink-0 mt-px">{ICONS[item.type]}</span>
      <span className="flex-1">{item.message}</span>
      <button
        onClick={onRemove}
        className="opacity-50 hover:opacity-100 ml-1 text-base leading-none"
      >
        ×
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const add = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = {
    success: (msg: string) => add("success", msg),
    error: (msg: string) => add("error", msg),
    info: (msg: string) => add("info", msg),
    warning: (msg: string) => add("warning", msg),
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast container */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[2000] flex flex-col gap-2.5 items-end">
          {toasts.map((item) => (
            <ToastItem
              key={item.id}
              item={item}
              onRemove={() => remove(item.id)}
            />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
