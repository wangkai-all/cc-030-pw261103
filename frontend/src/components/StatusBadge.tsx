import type { Stay } from "../types";
import { STATUS_STYLE } from "../lib/format";

export function StatusBadge({ status, compact = false }: { status: Stay["status"]; compact?: boolean }) {
  const style = STATUS_STYLE[status];
  return (
    <span className={`status-badge status-${status} ${compact ? "compact" : ""}`}>
      <span className="status-dot" />
      {compact ? style.short : style.label}
    </span>
  );
}
