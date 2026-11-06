// components/ui/Button.tsx
// Reusable button with variant and size props.

import { cn } from "@/lib/utils";
import { ButtonHTMLAttributes } from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "outline" | "ghost" | "danger" | "gold" | "export";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: React.ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  outline:
    "bg-white border-[1.5px] border-slate-200 text-slate-700 hover:border-blue-500 hover:text-blue-600",
  ghost:
    "bg-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-100",
  danger: "bg-red-50 text-red-600 hover:bg-red-100",
  gold: "bg-yellow-400 text-navy-dark hover:bg-yellow-300",
  export:
    "bg-blue-50 text-blue-600 border-[1.5px] border-blue-200 hover:bg-blue-100",
};

const sizeClasses: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs rounded-md",
  md: "px-3.5 py-2 text-sm rounded-lg",
};

export function Button({
  variant = "outline",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex items-center gap-1.5 font-semibold font-sans cursor-pointer whitespace-nowrap",
        "transition-all duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] active:scale-[0.985]",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size="sm" />
        </span>
      )}
      <span
        className={cn(
          "inline-flex items-center gap-1.5",
          loading && "invisible"
        )}
      >
        {children}
      </span>
    </button>
  );
}
