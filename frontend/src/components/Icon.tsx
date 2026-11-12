import type { ReactElement, SVGProps } from "react";

export type IconName =
  | "upload"
  | "close"
  | "chevron-right"
  | "chevron-down"
  | "locate"
  | "fit"
  | "plus"
  | "minus"
  | "layers"
  | "alert"
  | "clock"
  | "route"
  | "signal"
  | "check"
  | "pin"
  | "arrow-up-right"
  | "info"
  | "rotate"
  | "file"
  | "target"
  | "play"
  | "refresh"
  | "external"
  | "shield"
  | "grid"
  | "flag"
  | "arrow-right"
  | "search"
  | "download";

const paths: Record<IconName, ReactElement> = {
  upload: (
    <>
      <path d="M12 16V4m0 0L8 8m4-4 4 4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12M18 6L6 18" />
    </>
  ),
  "chevron-right": <path d="M9 18l6-6-6-6" />,
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  fit: (
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  layers: (
    <>
      <path d="M12 3L3 8l9 5 9-5-9-5Z" />
      <path d="M3 12l9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9L2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h5a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h7" />
    </>
  ),
  signal: (
    <>
      <path d="M4 20h.01M8 20v-4M12 20v-8M16 20V8M20 20V4" />
    </>
  ),
  check: <path d="M5 12l4 4L19 6" />,
  pin: (
    <>
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  "arrow-up-right": <path d="M7 17L17 7M7 7h10v10" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  rotate: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  play: <path d="M8 5l11 7-11 7V5Z" />,
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-2.7-6.4L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  external: (
    <>
      <path d="M14 3h7v7M10 14L21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  grid: (
    <>
      <path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4M5 4h12l-2.5 4L17 12H5" />
    </>
  ),
  "arrow-right": <path d="M4 12h16m0 0l-6-6m6 6l-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12m0 0l-4-4m4 4l4-4" />
      <path d="M5 20h14" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  ...props
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

export function BrandMark({ size = 42 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="46" height="46" rx="12" fill="#12352F" />
      <path d="M11 30.5L18.5 18l6 8.5L29 15l8 16" stroke="#F4F1E8" strokeWidth="1.6" strokeLinejoin="round" opacity=".55" />
      <path
        d="M14 35V26l5-4 5 4v9M29 35V24l4-3 4 3v11"
        stroke="#F4F1E8"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="19" cy="16" r="2.8" fill="#E7A36F" />
      <circle cx="19" cy="16" r="5.2" stroke="#E7A36F" strokeWidth="1" opacity=".45" />
    </svg>
  );
}
