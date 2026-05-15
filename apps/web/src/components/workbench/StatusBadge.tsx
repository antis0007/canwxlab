import type { SourceStatus } from "../../types/weather";

interface StatusBadgeProps {
  status: SourceStatus | "experimental" | "safe" | "core" | "research" | "unsafe";
  label?: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return <span className={`wb-badge wb-badge-${status}`}>{label ?? status.toUpperCase()}</span>;
}
