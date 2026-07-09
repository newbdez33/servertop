import type { MetricsSnapshot, SystemInfo } from '../../../shared/types';
import { fullscreenSupported, useFullscreen } from '../hooks/useFullscreen';
import type { ConnStatus } from '../hooks/useLive';
import { IS_DEMO } from '../lib/demo';
import { fmtUptime } from '../lib/format';
import { Pill, type Tone } from './ui';

const STATUS: Record<ConnStatus, { tone: Tone; label: string }> = {
  online: { tone: 'good', label: 'Online' },
  connecting: { tone: 'warn', label: 'Connecting' },
  offline: { tone: 'crit', label: 'Reconnecting' },
};

export function TopBar({
  system,
  snapshot,
  status,
  dark,
  onToggleTheme,
  onLogout,
}: {
  system: SystemInfo | null;
  snapshot: MetricsSnapshot | null;
  status: ConnStatus;
  dark: boolean;
  onToggleTheme: () => void;
  onLogout: (() => void) | null;
}) {
  const s = STATUS[status];
  const fs = useFullscreen();
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line px-4 pb-2 backdrop-blur-md [background:color-mix(in_srgb,var(--page)_82%,transparent)] [padding-top:max(0.5rem,env(safe-area-inset-top))]">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <span className="flex items-center gap-2 max-[480px]:hidden">
          <svg width="24" height="24" viewBox="0 0 30 30" aria-hidden="true">
            <rect x="1" y="1" width="28" height="28" rx="8" fill="var(--accent)" opacity="0.14" />
            <rect
              x="1"
              y="1"
              width="28"
              height="28"
              rx="8"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.4"
            />
            <polyline
              points="6,17 11,17 13,10 17,21 19,14 24,14"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <b className="text-[14px] font-semibold">ServerTop</b>
          <span className="h-[18px] w-px bg-line" />
        </span>
        <h1 className="m-0 text-[15px] font-semibold">{system?.hostname ?? '…'}</h1>
        <Pill tone={s.tone}>{s.label}</Pill>
        {IS_DEMO && <Pill tone="muted">Demo · simulated data</Pill>}
        {system && snapshot && (
          <span className="text-[11.5px] text-ink-3 max-[560px]:hidden">
            {system.os} · up <span className="num">{fmtUptime(snapshot.uptimeSec)}</span>
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1 rounded-[7px] border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-2"
          title="Data refresh interval (configured on the server)"
        >
          Refresh{' '}
          <span className="num text-ink">{((system?.sampleIntervalMs ?? 2000) / 1000).toFixed(0)}s</span>
        </span>
        {fullscreenSupported && (
          <button
            onClick={fs.toggle}
            className="grid size-7 cursor-pointer place-items-center rounded-[7px] border border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink"
            title={fs.active ? 'Exit fullscreen' : 'Fullscreen'}
            aria-label={fs.active ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {fs.active ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        )}
        <button
          onClick={onToggleTheme}
          className="grid size-7 cursor-pointer place-items-center rounded-[7px] border border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink"
          title="Toggle light / dark theme"
          aria-label="Toggle theme"
        >
          {dark ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
              <path
                d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
        {onLogout && (
          <button
            onClick={onLogout}
            className="grid size-7 cursor-pointer place-items-center rounded-[7px] border border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink"
            title="Disconnect / sign out"
            aria-label="Disconnect"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
