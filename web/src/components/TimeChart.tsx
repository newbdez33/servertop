import { useEffect, useId, useRef, useState } from 'react';
import { fmtClock } from '../lib/format';
import { Swatch } from './ui';

export interface ChartSeries {
  name: string;
  /** CSS color, e.g. 'var(--series-1)' */
  color: string;
  values: number[];
  area?: boolean;
}

interface Props {
  series: ChartSeries[];
  /** Timestamps (epoch ms) aligned with every series' values */
  ts: number[];
  yMax: number;
  yTicks: number[];
  yLab: (v: number) => string;
  fmt: (v: number) => string;
  endFmt?: (v: number) => string;
  height: number;
}

const M = { t: 10, r: 40, b: 18, l: 6 };

export function TimeChart({ series, ts, yMax, yTicks, yLab, fmt, endFmt, height }: Props) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = ts.length;
  const ready = width >= 60 && n >= 2;
  const iw = width - M.l - M.r;
  const ih = height - M.t - M.b;
  const x = (i: number): number => M.l + (iw * i) / (n - 1);
  const y = (v: number): number => M.t + ih * (1 - Math.min(yMax, Math.max(0, v)) / yMax);

  const pathFor = (values: number[]): string =>
    values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');

  const onMove = (ev: React.MouseEvent<SVGRectElement>): void => {
    const rect = ev.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!rect) return;
    const px = ev.clientX - rect.left;
    const i = Math.min(n - 1, Math.max(0, Math.round(((px - M.l) / iw) * (n - 1))));
    setHover(i);
  };

  const first = series[0];
  const tooltipW = 120;
  const tooltipLeft =
    hover === null
      ? 0
      : x(hover) + 12 + tooltipW > width - 4
        ? Math.max(4, x(hover) - tooltipW - 12)
        : x(hover) + 12;

  return (
    <div ref={wrapRef} className="relative" style={{ height }}>
      {!ready ? (
        <div className="grid h-full place-items-center text-[11px] text-ink-3">
          Collecting data…
        </div>
      ) : (
        <>
          <svg width={width} height={height}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: first.color }} stopOpacity="0.2" />
                <stop offset="1" style={{ stopColor: first.color }} stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {yTicks.map(t => (
              <g key={t}>
                <line
                  x1={M.l}
                  x2={M.l + iw}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--grid)"
                  strokeWidth="1"
                />
                <text className="axis-t" x={M.l + iw + 6} y={y(t) + 3.5}>
                  {yLab(t)}
                </text>
              </g>
            ))}

            {[0, 1, 2, 3].map(k => {
              const idx = Math.round(((n - 1) * k) / 3);
              return (
                <text
                  key={k}
                  className="axis-t"
                  textAnchor={k === 0 ? 'start' : k === 3 ? 'end' : 'middle'}
                  x={x(idx)}
                  y={height - 4}
                >
                  {fmtClock(ts[idx])}
                </text>
              );
            })}

            {series.map(s => {
              const d = pathFor(s.values);
              const lx = x(n - 1);
              const ly = y(s.values[n - 1]);
              return (
                <g key={s.name}>
                  {s.area && (
                    <path
                      d={`${d}L${x(n - 1).toFixed(1)} ${y(0)}L${x(0)} ${y(0)}Z`}
                      fill={`url(#${gid})`}
                    />
                  )}
                  <path d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
                  <circle
                    cx={lx}
                    cy={ly}
                    r="3"
                    fill={s.color}
                    stroke="var(--surface)"
                    strokeWidth="1.5"
                  />
                  <text className="endlab" textAnchor="end" x={lx - 8} y={ly - 6}>
                    {(endFmt ?? fmt)(s.values[n - 1])}
                  </text>
                </g>
              );
            })}

            {hover !== null && (
              <g>
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={M.t}
                  y2={M.t + ih}
                  stroke="var(--ink-3)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                {series.map(s => (
                  <circle
                    key={s.name}
                    cx={x(hover)}
                    cy={y(s.values[hover])}
                    r="3.5"
                    fill={s.color}
                    stroke="var(--surface)"
                    strokeWidth="1.5"
                  />
                ))}
              </g>
            )}

            <rect
              x={M.l}
              y={M.t}
              width={iw}
              height={ih}
              fill="transparent"
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
            />
          </svg>

          {hover !== null && (
            <div
              className="pointer-events-none absolute z-10 min-w-[108px] rounded-lg border border-line bg-surface px-2 py-1.5 text-[11.5px] shadow-lg"
              style={{ left: tooltipLeft, top: M.t + 4 }}
            >
              <div className="num mb-0.5 text-[10.5px] text-ink-3">{fmtClock(ts[hover])}</div>
              {series.map(s => (
                <div key={s.name} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <Swatch color={s.color} /> {s.name}
                  </span>
                  <span className="num font-semibold">{fmt(s.values[hover])}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
