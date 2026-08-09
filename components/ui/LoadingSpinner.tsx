// components/ui/LoadingSpinner.tsx
// ─────────────────────────────────────────────
// Full-page loading spinner shown while auth
// state rehydrates from cookies on first render.
//
// FIX: previously relied only on Tailwind's `animate-spin` utility class.
// If that class ever gets purged (unused-class detection edge cases), or a
// parent applies a conflicting `transform`/`animation` style, the spinner
// renders as a static ring with no visible rotation. This version defines
// its own keyframes and applies the animation as an explicit inline style,
// so rotation does not depend on Tailwind's utility class being present.

interface LoadingSpinnerProps {
  fullPage?: boolean;
  size?: "sm" | "md" | "lg";
}

const sizeMap = { sm: 20, md: 32, lg: 48 };

export function LoadingSpinner({
  fullPage = false,
  size = "md",
}: LoadingSpinnerProps) {
  const px = sizeMap[size];

  const spinner = (
    <>
      <style>{`
        @keyframes loading-spinner-rotate {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        role="status"
        aria-label="Loading"
        style={{
          width: px,
          height: px,
          borderRadius: "9999px",
          border: "3px solid #e2e8f0",
          borderTopColor: "#2563eb",
          animation: "loading-spinner-rotate 0.7s linear infinite",
          boxSizing: "border-box",
        }}
      />
    </>
  );

  if (fullPage) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white z-50">
        {spinner}
      </div>
    );
  }

  return <div className="flex items-center justify-center p-8">{spinner}</div>;
}
