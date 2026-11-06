// components/ui/LoadingSpinner.tsx
import { Spinner } from "./Spinner";

interface LoadingSpinnerProps {
  fullPage?: boolean;
  size?: "sm" | "md" | "lg";
}

export function LoadingSpinner({
  fullPage = false,
  size = "md",
}: LoadingSpinnerProps) {
  const spinner = <Spinner size={size} className="text-blue-600" />;

  if (fullPage) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white z-50">
        {spinner}
      </div>
    );
  }
  return <div className="flex items-center justify-center p-8">{spinner}</div>;
}
