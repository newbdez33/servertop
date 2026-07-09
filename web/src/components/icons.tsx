import type { ReactNode } from 'react';

function I({
  children,
  color,
  size = 14,
}: {
  children: ReactNode;
  color?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color }}
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

export type IconProps = { color?: string; size?: number };

export const CpuIcon = (p: IconProps) => (
  <I {...p}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
    <rect x="10" y="10" width="4" height="4" />
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
  </I>
);

export const MemIcon = (p: IconProps) => (
  <I {...p}>
    <rect x="2" y="6.5" width="20" height="9" rx="1.5" />
    <path d="M7 10v2.5M12 10v2.5M17 10v2.5" />
    <path d="M6 15.5V19M12 15.5V19M18 15.5V19" />
  </I>
);

export const DiskIcon = (p: IconProps) => (
  <I {...p}>
    <line x1="22" y1="12" x2="2" y2="12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    <line x1="6" y1="16" x2="6.01" y2="16" />
    <line x1="10" y1="16" x2="10.01" y2="16" />
  </I>
);

export const NetIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M7 4v13M7 17l-3.5-3.5M7 17l3.5-3.5" />
    <path d="M17 20V7M17 7l-3.5 3.5M17 7l3.5 3.5" />
  </I>
);

export const ActivityIcon = (p: IconProps) => (
  <I {...p}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </I>
);

export const BoxIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </I>
);

export const InfoIcon = (p: IconProps) => (
  <I {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </I>
);
