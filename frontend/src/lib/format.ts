const TIME_ZONE = "Asia/Shanghai";

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const shortTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: TIME_ZONE,
  month: "long",
  day: "numeric",
  weekday: "short",
});

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return timeFormatter.format(date);
}

export function formatTimeShort(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return shortTimeFormatter.format(date);
}

export function formatDateCN(value: string): string {
  const date = new Date(`${value}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter.format(date).replace("星期", "周");
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours} 时 ${String(minutes).padStart(2, "0")} 分`;
  }
  return `${minutes} 分 ${String(secs).padStart(2, "0")} 秒`;
}

export function formatDurationCompact(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatGap(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

export function formatArea(area: number): string {
  if (area >= 10000) return `${(area / 10000).toFixed(2)} 公顷`;
  return `${Math.round(area).toLocaleString("zh-CN")} m²`;
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 2)} km`;
  return `${Math.round(meters)} m`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

export function formatCoordinate(value: number): string {
  return value.toFixed(1);
}

export const CLASSIFICATION_LABEL = {
  inside: "围栏内",
  buffer: "缓冲带",
  outside: "缓冲外",
  hole: "内部空洞",
} as const;

export const ACTION_LABEL: Record<string, string> = {
  entry_first: "进入 · 回记点",
  entry_second: "进入 · 确认点",
  exit_first: "退出 · 回记点",
  exit_second: "退出 · 确认点",
  buffer_hold: "缓冲保持",
  outside_wait: "越界待确认",
  inside_observe: "场内观测",
  gap_last: "断档前最后点",
  ongoing_last: "轨迹末点",
  hole: "空洞外",
  buffer: "缓冲点",
  outside: "场外点",
  observation: "观测点",
};

export const STATUS_STYLE = {
  complete: {
    label: "完整驻留",
    short: "完整",
    color: "var(--success)",
  },
  incomplete: {
    label: "不完整",
    short: "不完整",
    color: "var(--warning)",
  },
  ongoing: {
    label: "进行中",
    short: "进行中",
    color: "var(--info)",
  },
} as const;

export function vehicleShort(label: string): string {
  return label.split("·").slice(0, 2).join("·").trim();
}

export function vehicleRole(label: string): string {
  const parts = label.split("·");
  return parts.length > 2 ? parts.slice(2).join("·").trim() : "";
}
