// components/ui/Spinner.tsx
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

const sizeClasses: Record<Size, string> = {
  sm: "w-4 h-4 border-2",
  md: "w-6 h-6 border-[3px]",
  lg: "w-10 h-10 border-[3px]",
};

interface SpinnerProps {
  size?: Size;
  className?: string; // set color with text-*, e.g. "text-blue-600"
  label?: string;
}

/** Uses the current text color, so it works on white and on colored buttons. */
export function Spinner({
  size = "sm",
  className,
  label = "Loading",
}: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      data-spinner
      className={cn(
        "inline-block shrink-0 rounded-full border-current border-t-transparent animate-spin",
        sizeClasses[size],
        className
      )}
    />
  );
}
