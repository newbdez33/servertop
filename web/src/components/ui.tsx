import type { CSSProperties, ReactNode } from 'react';

export function Card({
  children,
  className = '',
  i = 0,
  title,
}: {
  children: ReactNode;
  className?: string;
  i?: number;
  title?: string;
}) {
  return (
    <section
      className={`card-rise min-w-0 rounded-[10px] border border-line bg-surface p-2.5 [box-shadow:var(--shadow)] ${className}`}
      style={{ '--i': i } as CSSProperties}
      title={title}
    >
      {children}
    </section>
  );
}

export function CardHead({
  title,
  icon,
  sub,
  right,
}: {
  title: string;
  icon?: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
          {icon}
          {title}
        </h2>
        {sub && <span className="text-[10.5px] text-ink-3">{sub}</span>}
      </div>
      {right}
    </div>
  );
}

export type Tone = 'good' | 'warn' | 'crit' | 'muted';

const DOT: Record<Tone, string> = {
  good: 'bg-good',
  warn: 'bg-warn',
  crit: 'bg-crit',
  muted: 'bg-ink-3 opacity-50',
};
const TEXT: Record<Tone, string> = {
  good: 'text-good',
  warn: 'text-ink',
  crit: 'text-crit',
  muted: 'text-ink-3',
};

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pr-2.5 pl-2 text-[11px] font-semibold ${TEXT[tone]}`}
    >
      <span className={`size-[7px] shrink-0 -translate-y-[0.5px] rounded-full ${DOT[tone]}`} />
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  return <span className={`size-[7px] shrink-0 -translate-y-[0.5px] rounded-full ${DOT[tone]}`} />;
}

export function Swatch({ color, border = false }: { color: string; border?: boolean }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-[2.5px]"
      style={{ background: color, border: border ? '1px solid var(--line)' : undefined }}
    />
  );
}

export function BarRow({
  label,
  pct,
  tone = 'default',
  color = 'var(--series-1)',
  decimals = 1,
}: {
  label: string;
  pct: number;
  tone?: 'default' | 'warn' | 'crit';
  /** Fill color when tone is 'default' (CSS color, e.g. 'var(--disk)') */
  color?: string;
  decimals?: number;
}) {
  const fill = tone === 'crit' ? 'var(--crit)' : tone === 'warn' ? 'var(--warn)' : color;
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="grid grid-cols-[3.4rem_1fr_2.8rem] items-center gap-2">
      <span className="num truncate text-[11px] text-ink-2">{label}</span>
      <span className="block h-[7px] overflow-hidden rounded-full bg-surface-2">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${clamped}%`, background: fill }}
        />
      </span>
      <span className="num text-right text-[11px] text-ink-2">{pct.toFixed(decimals)}%</span>
    </div>
  );
}
