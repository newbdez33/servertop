import { useState } from 'react';
import type {
  AgentSessionsInfo,
  LlmInfo,
  ContainerInfo,
  HistoryPoint,
  MetricsSnapshot,
  ProcessInfo,
  SystemInfo,
} from '../../../shared/types';
import { HISTORY_LEN } from '../hooks/useLive';
import { fmtAgo, fmtBytes, fmtGB, fmtGBdec, fmtRate, fmtUptime, niceMax, toMBs } from '../lib/format';
import {
  ActivityIcon,
  BoxIcon,
  CpuIcon,
  ZapIcon,
  DiskIcon,
  InfoIcon,
  MemIcon,
  NetIcon,
} from './icons';
import { Sparkline, type SparkSeries } from './Sparkline';
import { TimeChart } from './TimeChart';
import { BarRow, Card, CardHead, Dot, Swatch } from './ui';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

/** "Last N min" derived from the actual window (HISTORY_LEN × sample interval) */
const windowLabel = (intervalMs: number): string => {
  const min = (HISTORY_LEN * intervalMs) / 60_000;
  return `Last ${min >= 1 ? Math.round(min) : +min.toFixed(1)} min`;
};

/** MB/s axis label with enough precision that adjacent ticks stay distinct */
const mbLabel = (v: number): string =>
  v >= 1 ? `${+v.toFixed(1)}M` : `${Math.round(v * 1000)}K`;

/** Green → amber → red by load (text-safe tokens) */
const loadTone = (pct: number): string =>
  pct >= 70 ? 'var(--load-high)' : pct >= 30 ? 'var(--load-mid)' : 'var(--load-low)';

/* ── Stat tiles ─────────────────────────────────────────────────────── */

export interface CardBase {
  className: string;
  i: number;
}

interface TileData {
  snapshot: MetricsSnapshot;
  history: HistoryPoint[];
}

const spark = (history: HistoryPoint[], sel: (h: HistoryPoint) => number): number[] =>
  history.slice(-30).map(sel);

export function CpuTile({
  className,
  i,
  snapshot,
  history,
  system,
}: CardBase & TileData & { system: SystemInfo | null }) {
  const { cpu } = snapshot;
  return (
    <Tile
      className={className}
      i={i}
      label="CPU"
      icon={<CpuIcon size={13} color="var(--cpu)" />}
      tooltip={system ? `${system.cpuModel} · ${system.cores} cores` : undefined}
      value={cpu.usage.toFixed(1)}
      unit="%"
      ctx={
        <>
          <span className="num">{cpu.perCore.length}</span> cores · load{' '}
          <span className="num">{cpu.load[0].toFixed(2)}</span>
        </>
      }
      series={[{ values: spark(history, h => h.cpu), color: 'var(--cpu)' }]}
    />
  );
}

export function MemoryTile({ className, i, snapshot, history }: CardBase & TileData) {
  const { mem } = snapshot;
  const memPct = mem.total ? (mem.used / mem.total) * 100 : 0;
  const cachedPct = mem.total ? (mem.cached / mem.total) * 100 : 0;
  const tooltip =
    `Used ${fmtGB(mem.used, 1)} GB (${memPct.toFixed(0)}%) · ` +
    `Cache/buffer ${fmtGB(mem.cached, 1)} GB (${cachedPct.toFixed(0)}%) · ` +
    `Free ${fmtGB(mem.free, 1)} GB · ` +
    `Swap ${fmtGB(mem.swapUsed, 1)} / ${fmtGB(mem.swapTotal, 1)} GB`;
  return (
    <Tile
      className={className}
      i={i}
      label="Memory"
      icon={<MemIcon size={13} color="var(--mem)" />}
      tooltip={tooltip}
      value={memPct.toFixed(1)}
      unit="%"
      ctx={
        <>
          <span className="num">{fmtGB(mem.used, 1)}</span> /{' '}
          <span className="num">{fmtGB(mem.total)}</span> GB · cache{' '}
          <span className="num">{fmtGB(mem.cached)}</span> GB
          {mem.swapUsed >= 0.1 * GB && (
            <>
              {' '}
              · swap <span className="num">{fmtGB(mem.swapUsed, 1)}</span> GB
            </>
          )}
        </>
      }
      extra={
        <div className="flex h-1 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
          <span style={{ width: `${memPct}%`, background: 'var(--mem)' }} />
          <span style={{ width: `${cachedPct}%`, background: 'var(--mem-soft)' }} />
          <span className="flex-1" style={{ background: 'var(--surface-2)' }} />
        </div>
      }
      series={[{ values: spark(history, h => h.mem), color: 'var(--mem)' }]}
    />
  );
}

/** Anti-aliased SVG pie: track circle + filled wedge from 12 o'clock, clockwise */
function Pie({
  pct,
  color,
  size = 30,
}: {
  pct: number;
  color: string;
  size?: number;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  const c = size / 2;
  const r = c - 1; // room for the hairline ring
  let wedge: string | null = null;
  if (clamped >= 99.5) {
    wedge = 'full';
  } else if (clamped >= 0.5) {
    const angle = (clamped / 100) * 2 * Math.PI;
    const x = c + r * Math.sin(angle);
    const y = c - r * Math.cos(angle);
    wedge = `M ${c} ${c} L ${c} ${c - r} A ${r} ${r} 0 ${clamped > 50 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="var(--surface-2)" stroke="var(--line)" strokeWidth="1" />
      {wedge === 'full' ? (
        <circle cx={c} cy={c} r={r} fill={color} />
      ) : (
        wedge && <path d={wedge} fill={color} />
      )}
    </svg>
  );
}

export function DiskTile({ className, i, snapshot }: CardBase & TileData) {
  const disks = snapshot.disk;
  const rootDisk = disks.find(d => d.mount === '/') ?? disks[0];
  const alert = disks.reduce(
    (worst, d) => (d.usedPct > 85 && d.usedPct > (worst?.usedPct ?? 0) ? d : worst),
    null as (typeof disks)[number] | null,
  );
  const alertColor = alert && alert.usedPct > 95 ? 'var(--load-high)' : 'var(--load-mid)';
  return (
    <Tile
      className={className}
      i={i}
      label={rootDisk ? `Disk ${rootDisk.mount}` : 'Disk'}
      icon={<DiskIcon size={13} color="var(--disk)" />}
      tooltip={disks.map(d => `${d.mount} ${d.usedPct.toFixed(1)}%`).join(' · ')}
      value={rootDisk ? rootDisk.usedPct.toFixed(1) : '—'}
      unit="%"
      valueColor={
        rootDisk && rootDisk.usedPct > 95
          ? 'var(--load-high)'
          : rootDisk && rootDisk.usedPct > 85
            ? 'var(--load-mid)'
            : undefined
      }
      ctx={
        rootDisk ? (
          <>
            <span className="num">{fmtGBdec(rootDisk.used)}</span> /{' '}
            <span className="num">{fmtGBdec(rootDisk.size)}</span> GB
            {alert && (
              <span style={{ color: alertColor }}>
                {' '}
                · ⚠ <span className="num">{alert.mount}</span>{' '}
                <span className="num">{alert.usedPct.toFixed(0)}%</span>
              </span>
            )}
          </>
        ) : (
          'no data'
        )
      }
      sparkSlot={
        rootDisk && (
          <Pie
            pct={rootDisk.usedPct}
            size={30}
            color={
              rootDisk.usedPct > 95
                ? 'var(--load-high)'
                : rootDisk.usedPct > 85
                  ? 'var(--load-mid)'
                  : 'var(--disk)'
            }
          />
        )
      }
    />
  );
}

export function NetworkTile({ className, i, snapshot, history }: CardBase & TileData) {
  const primary = snapshot.net[0];
  return (
    <Tile
      className={className}
      i={i}
      label="Network"
      icon={<NetIcon size={13} color="var(--net-rx)" />}
      value={`↓${primary ? fmtRate(primary.rxSec).replace(/ /, ' ') : '—'}`}
      unit=""
      small
      ctx={
        <>
          up ↑ <span className="num">{primary ? fmtRate(primary.txSec) : '—'}</span>
          {primary ? ` · ${primary.iface}` : ''}
        </>
      }
      series={[
        { values: spark(history, h => toMBs(h.rx)), color: 'var(--net-rx)' },
        { values: spark(history, h => toMBs(h.tx)), color: 'var(--net-tx)' },
      ]}
    />
  );
}

function Tile({
  className,
  i,
  label,
  icon,
  value,
  unit,
  ctx,
  series = [],
  sparkSlot,
  tooltip,
  valueColor,
  extra,
  small = false,
}: CardBase & {
  label: string;
  icon: React.ReactNode;
  value: string;
  unit: string;
  ctx: React.ReactNode;
  series?: SparkSeries[];
  sparkSlot?: React.ReactNode;
  tooltip?: string;
  valueColor?: string;
  extra?: React.ReactNode;
  small?: boolean;
}) {
  return (
    <Card i={i} title={tooltip} className={`flex flex-col gap-1 ${className}`}>
      <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.06em] text-ink-2 uppercase">
        {icon}
        {label}
      </span>
      <div className="flex items-end justify-between gap-2">
        <span
          className={`num font-semibold leading-none tracking-tight ${small ? 'text-[15px]' : 'text-[19px]'}`}
          style={valueColor ? { color: valueColor } : undefined}
        >
          {value}
          {unit && <small className="text-[11px] font-medium text-ink-3">{unit}</small>}
        </span>
        {sparkSlot ?? <Sparkline series={series} />}
      </div>
      {extra}
      <span className="block truncate text-[10.5px] text-ink-3">{ctx}</span>
    </Card>
  );
}

/* ── CPU ────────────────────────────────────────────────────────────── */

export function CpuCard({
  className,
  i,
  snapshot,
  history,
  intervalMs,
}: CardBase & {
  snapshot: MetricsSnapshot;
  history: HistoryPoint[];
  intervalMs: number;
}) {
  return (
    <Card i={i} className={className}>
      <CardHead
        title="CPU Usage"
        icon={<CpuIcon color="var(--cpu)" />}
        sub={
          <>
            {windowLabel(intervalMs)} · every {(intervalMs / 1000).toFixed(0)}s
            {snapshot.cpu.tempC !== null && (
              <>
                {' · '}
                <span
                  className="num"
                  style={{
                    color: snapshot.cpu.tempC >= 70 ? loadTone(snapshot.cpu.tempC) : undefined,
                  }}
                >
                  {snapshot.cpu.tempC}°C
                </span>
              </>
            )}
          </>
        }
        right={
          <span className="text-[11px] text-ink-2">
            <span className="num font-semibold text-ink">{snapshot.cpu.usage.toFixed(1)}%</span> now
          </span>
        }
      />
      <TimeChart
        series={[
          {
            name: 'CPU',
            color: 'var(--cpu)',
            values: history.map(h => h.cpu),
            area: true,
          },
        ]}
        ts={history.map(h => h.ts)}
        yMax={100}
        yTicks={[0, 50, 100]}
        yLab={v => `${v}%`}
        fmt={v => `${v.toFixed(1)}%`}
        height={90}
      />
    </Card>
  );
}

/* ── Memory ─────────────────────────────────────────────────────────── */

export function MemoryCard({ className, i, snapshot }: CardBase & { snapshot: MetricsSnapshot }) {
  const { mem } = snapshot;
  const pct = (v: number): number => (mem.total ? (v / mem.total) * 100 : 0);
  const usedPct = pct(mem.used);
  const cachedPct = pct(mem.cached);
  const freePct = Math.max(0, 100 - usedPct - cachedPct);
  const swapPct = mem.swapTotal ? (mem.swapUsed / mem.swapTotal) * 100 : 0;

  const rows: Array<{ swatch: React.ReactNode; label: string; value: string; note: string }> = [
    {
      swatch: <Swatch color="var(--mem)" />,
      label: 'Used',
      value: `${fmtGB(mem.used, 1)} GB`,
      note: `${usedPct.toFixed(0)}%`,
    },
    {
      swatch: <Swatch color="var(--mem-soft)" />,
      label: 'Cache / buffer',
      value: `${fmtGB(mem.cached, 1)} GB`,
      note: `${cachedPct.toFixed(0)}%`,
    },
    {
      swatch: <Swatch color="var(--surface-2)" border />,
      label: 'Free',
      value: `${fmtGB(mem.free, 1)} GB`,
      note: `${freePct.toFixed(0)}%`,
    },
  ];

  return (
    <Card i={i} className={className}>
      <CardHead
        title="Memory"
        icon={<MemIcon color="var(--mem)" />}
        sub={`${fmtGB(mem.total)} GB total`}
      />
      <div className="mb-1.5 flex h-2.5 gap-[2px] overflow-hidden rounded-md" aria-hidden="true">
        <span className="h-full" style={{ width: `${usedPct}%`, background: 'var(--mem)' }} />
        <span
          className="h-full"
          style={{ width: `${cachedPct}%`, background: 'var(--mem-soft)' }}
        />
        <span className="h-full flex-1" style={{ background: 'var(--surface-2)' }} />
      </div>
      <div>
        {rows.map((r, idx) => (
          <div
            key={r.label}
            className={`flex items-center gap-2 py-[3px] text-[11px] ${idx ? 'border-t border-line' : ''}`}
          >
            {r.swatch}
            <span className="flex-1 text-ink-2">{r.label}</span>
            <span className="num">
              {r.value} <span className="text-ink-3">· {r.note}</span>
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2 border-t border-line py-[3px] text-[11px]">
          <span className="size-2 shrink-0" />
          <span className="flex-1 text-ink-2">Swap</span>
          <span className="num">
            {fmtGB(mem.swapUsed, 1)} / {fmtGB(mem.swapTotal, 1)} GB{' '}
            <span className="text-ink-3">· {swapPct.toFixed(0)}%</span>
          </span>
        </div>
      </div>
    </Card>
  );
}

/* ── Network ────────────────────────────────────────────────────────── */

export function NetworkCard({
  className,
  i,
  snapshot,
  history,
  intervalMs,
}: CardBase & {
  snapshot: MetricsSnapshot;
  history: HistoryPoint[];
  intervalMs: number;
}) {
  const primary = snapshot.net[0];
  const rx = history.map(h => toMBs(h.rx));
  const tx = history.map(h => toMBs(h.tx));
  const yMax = niceMax(Math.max(...rx, ...tx, 0.1) * 1.15);
  const yTicks = [0, yMax / 2, yMax].map(v => +v.toFixed(3));

  return (
    <Card i={i} className={className}>
      <CardHead
        title={`Network${primary ? ` · ${primary.iface}` : ''}`}
        icon={<NetIcon color="var(--net-rx)" />}
        sub={windowLabel(intervalMs)}
        right={
          <span className="flex items-center gap-3 text-[11px] text-ink-2">
            <span className="flex items-center gap-1.5">
              <Swatch color="var(--net-rx)" /> Down{' '}
              <span className="num font-semibold text-ink">
                {primary ? fmtRate(primary.rxSec) : '—'}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <Swatch color="var(--net-tx)" /> Up{' '}
              <span className="num font-semibold text-ink">
                {primary ? fmtRate(primary.txSec) : '—'}
              </span>
            </span>
          </span>
        }
      />
      <TimeChart
        series={[
          { name: 'Down', color: 'var(--net-rx)', values: rx, area: true },
          { name: 'Up', color: 'var(--net-tx)', values: tx },
        ]}
        ts={history.map(h => h.ts)}
        yMax={yMax}
        yTicks={yTicks}
        yLab={mbLabel}
        fmt={v => fmtRate(v * MB)}
        endFmt={mbLabel}
        height={90}
      />
    </Card>
  );
}

/* ── Disks ──────────────────────────────────────────────────────────── */

export function DiskCard({ className, i, snapshot }: CardBase & { snapshot: MetricsSnapshot }) {
  const disks = snapshot.disk;
  const alerts = disks.filter(d => d.usedPct > 85);
  return (
    <Card i={i} className={className}>
      <CardHead
        title="Disk Partitions"
        icon={<DiskIcon color="var(--disk)" />}
        sub={`${disks.length} mount point${disks.length === 1 ? '' : 's'}`}
      />
      <div className="flex flex-col gap-2">
        {disks.map(d => (
          <BarRow
            key={d.mount}
            label={d.mount}
            pct={d.usedPct}
            tone={d.usedPct > 95 ? 'crit' : d.usedPct > 85 ? 'warn' : 'default'}
            color="var(--disk)"
          />
        ))}
        {disks.length === 0 && <span className="text-[11px] text-ink-3">No disk data</span>}
      </div>
      {alerts.length > 0 && (
        <div className="mt-1.5 border-t border-line pt-1.5">
          {alerts.map(d => (
            <div key={d.mount} className="flex items-center gap-2 py-0.5 text-[11px]">
              <Dot tone={d.usedPct > 95 ? 'crit' : 'warn'} />
              <span className="flex-1 text-ink-2">
                <span className="num">{d.mount}</span> usage over {d.usedPct > 95 ? '95' : '85'}%
              </span>
              <span className="num text-ink-3">{d.usedPct > 95 ? 'Critical' : 'Warning'}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── Processes ──────────────────────────────────────────────────────── */

export function ProcessCard({
  className,
  i,
  processes,
  limit = 6,
}: CardBase & { processes: ProcessInfo[]; limit?: number }) {
  const [sort, setSort] = useState<'cpu' | 'mem'>('cpu');
  const rows = [...processes]
    .sort((a, b) => (sort === 'cpu' ? b.cpu - a.cpu : b.memBytes - a.memBytes))
    .slice(0, limit);

  return (
    <Card i={i} className={className}>
      <CardHead
        title="Processes"
        icon={<ActivityIcon color="var(--cpu)" />}
        sub={`Top ${limit} by ${sort === 'cpu' ? 'CPU' : 'memory'}`}
        right={
          <button
            onClick={() => setSort(s => (s === 'cpu' ? 'mem' : 'cpu'))}
            className="cursor-pointer rounded-[7px] border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-2 hover:bg-surface-2"
            title="Toggle sort: CPU / memory"
          >
            {sort === 'cpu' ? 'CPU' : 'Mem'} ▾
          </button>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr>
              <Th>PID</Th>
              <Th>Name</Th>
              <Th className="@max-[26rem]:hidden">User</Th>
              <Th right>CPU</Th>
              <Th right>Mem</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.pid} className="hover:bg-surface-2">
                <Td className="num text-ink-3">{p.pid}</Td>
                <Td className="w-full max-w-0 font-semibold">
                  <span className="block truncate" title={p.name}>
                    {p.name}
                  </span>
                </Td>
                <Td className="text-ink-3 @max-[26rem]:hidden">{p.user}</Td>
                <Td right>
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <span className="block h-[7px] w-[46px] overflow-hidden rounded-full bg-surface-2">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.min(100, p.cpu * 2)}%`,
                          background: loadTone(p.cpu),
                        }}
                      />
                    </span>
                    <span className="num font-semibold" style={{ color: loadTone(p.cpu) }}>
                      {p.cpu.toFixed(1)}%
                    </span>
                  </span>
                </Td>
                <Td right className="num">
                  {fmtBytes(p.memBytes)}
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <Td className="text-ink-3">—</Td>
                <Td className="text-ink-3">Collecting…</Td>
                <Td> </Td>
                <Td right> </Td>
                <Td right> </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Th({
  children,
  right = false,
  className = '',
}: {
  children: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <th
      className={`border-b border-line px-2 py-0.5 text-[10px] font-semibold tracking-wider whitespace-nowrap text-ink-3 uppercase ${right ? 'text-right' : 'text-left'} ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right = false,
  className = '',
}: {
  children: React.ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`border-b border-line px-2 py-[3px] whitespace-nowrap ${right ? 'text-right' : ''} ${className}`}
    >
      {children}
    </td>
  );
}

/* ── Docker containers ──────────────────────────────────────────────── */

export function ContainerCard({
  className,
  i,
  containers,
  available,
  limit = 6,
}: CardBase & { containers: ContainerInfo[]; available: boolean; limit?: number }) {
  const running = containers.filter(c => c.state === 'running').length;
  // Running containers first, capped for a compact single-screen layout
  const visible = [...containers]
    .sort((a, b) =>
      a.state === b.state ? a.name.localeCompare(b.name) : a.state === 'running' ? -1 : 1,
    )
    .slice(0, limit);
  const hidden = containers.length - visible.length;
  return (
    <Card i={i} className={className}>
      <CardHead
        title="Docker Containers"
        icon={<BoxIcon color="var(--net-rx)" />}
        sub={
          available
            ? `${containers.length} container${containers.length === 1 ? '' : 's'} · ${running} running`
            : undefined
        }
      />
      {!available ? (
        <p className="py-2 text-[11.5px] text-ink-3">
          Docker socket not available — mount /var/run/docker.sock to enable container monitoring.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th className="@max-[28rem]:hidden">Image</Th>
                <Th>Status</Th>
                <Th right>CPU</Th>
                <Th right>Mem</Th>
                <Th right className="@max-[28rem]:hidden">Uptime</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map(c => (
                <tr key={c.id} className="hover:bg-surface-2">
                  <Td className="font-semibold">
                    <span className="block max-w-[9rem] truncate" title={c.name}>
                      {c.name}
                    </span>
                  </Td>
                  <Td className="num text-ink-3 @max-[28rem]:hidden">
                    <span className="block max-w-[8rem] truncate" title={c.image}>
                      {c.image}
                    </span>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium">
                      <Dot
                        tone={
                          c.state === 'running' ? 'good' : c.state === 'exited' ? 'crit' : 'muted'
                        }
                      />
                      {c.state === 'running' ? 'Running' : c.state === 'exited' ? 'Exited' : c.state}
                    </span>
                  </Td>
                  <Td right className="num">
                    {c.cpuPct !== null ? `${c.cpuPct.toFixed(1)}%` : '—'}
                  </Td>
                  <Td right className="num">
                    {c.memBytes !== null ? fmtBytes(c.memBytes) : '—'}
                  </Td>
                  <Td right className="num text-ink-3 @max-[28rem]:hidden">
                    {c.startedAt === null
                      ? '—'
                      : c.state === 'running'
                        ? fmtUptime((Date.now() - c.startedAt) / 1000)
                        : fmtAgo(c.startedAt)}
                  </Td>
                </tr>
              ))}
              {containers.length === 0 && (
                <tr>
                  <Td className="text-ink-3">No containers</Td>
                  <Td> </Td>
                  <Td> </Td>
                  <Td right> </Td>
                  <Td right> </Td>
                  <Td right> </Td>
                </tr>
              )}
            </tbody>
          </table>
          {hidden > 0 && (
            <p className="m-0 pt-1 text-[10.5px] text-ink-3">
              +{hidden} more not shown ({containers.filter(c => c.state !== 'running').length}{' '}
              stopped)
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Claude Code sessions ───────────────────────────────────────────── */

const basename = (p: string): string => p.split('/').filter(Boolean).pop() ?? p;

export function AgentSessionsCard({
  className,
  i,
  title,
  icon,
  data,
  limit = 6,
}: CardBase & {
  title: string;
  icon: React.ReactNode;
  data: AgentSessionsInfo | null;
  limit?: number;
}) {
  if (!data?.available) return null;
  const { stats } = data;
  const rows = data.sessions.slice(0, limit);
  return (
    <Card i={i} className={className}>
      <CardHead
        title={title}
        icon={icon}
        sub={`${stats.sessionsToday} today · ${stats.totalSessions} sessions in ${stats.totalProjects} projects`}
        right={
          stats.activeNow > 0 ? (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-good">
              <Dot tone="good" />
              {stats.activeNow} running
            </span>
          ) : undefined
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr>
              <Th>Project</Th>
              <Th>Session</Th>
              <Th right>Turns</Th>
              <Th right>Active</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(sess => (
              <tr key={sess.id} className="hover:bg-surface-2">
                <Td className="font-semibold">
                  <span className="flex items-center gap-1.5">
                    <Dot tone={sess.active ? 'good' : 'muted'} />
                    <span
                      className="block max-w-[8rem] truncate"
                      title={`${sess.project}${sess.gitBranch ? ` (${sess.gitBranch})` : ''}`}
                    >
                      {basename(sess.project)}
                    </span>
                  </span>
                </Td>
                <Td className="w-full max-w-0 text-ink-2">
                  <span className="block truncate" title={sess.title}>
                    {sess.title}
                  </span>
                </Td>
                <Td right className="num">
                  {sess.turns ?? '—'}
                </Td>
                <Td right className={`num ${sess.active ? 'font-semibold text-good' : 'text-ink-3'}`}>
                  {sess.active ? 'now' : fmtAgo(sess.lastActiveAt)}
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <Td className="text-ink-3">No sessions</Td>
                <Td> </Td>
                <Td right> </Td>
                <Td right> </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── LLM servers ────────────────────────────────────────────────────── */

const fmtCtx = (v: number | null): string => {
  if (v === null) return '—';
  if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1024) return `${Math.round(v / 1024)}K`;
  return String(v);
};

export function LlmCard({
  className,
  i,
  llm,
  limit = 6,
}: CardBase & { llm: LlmInfo | null; limit?: number }) {
  if (!llm?.available) return null;
  const rows = llm.servers.slice(0, limit);
  const upCount = llm.servers.filter(s => s.up).length;
  const busy = llm.servers.reduce((n, s) => n + (s.slotsBusy ?? 0), 0);
  return (
    <Card i={i} className={className}>
      <CardHead
        title="LLM Servers"
        icon={<ZapIcon color="var(--accent)" />}
        right={
          <span className="flex items-center gap-2">
            {busy > 0 && (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-good">
                <Dot tone="good" />
                {busy} generating
              </span>
            )}
            <span
              className={`num text-[10.5px] ${upCount === llm.servers.length ? 'text-ink-3' : 'font-semibold text-crit'}`}
            >
              {upCount}/{llm.servers.length} up
            </span>
          </span>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr>
              <Th>Server</Th>
              <Th>Model</Th>
              <Th right className="@max-[28rem]:hidden">Ctx</Th>
              <Th right>Slots</Th>
              <Th right className="@max-[28rem]:hidden">Ping</Th>
              <Th right>CPU</Th>
              <Th right>Mem</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.url} className="hover:bg-surface-2">
                <Td className="font-semibold">
                  <span className="flex items-center gap-1.5">
                    <Dot tone={s.up ? 'good' : 'crit'} />
                    <span className="block max-w-[9rem] truncate" title={s.url}>
                      {s.name}
                    </span>
                  </span>
                </Td>
                <Td className="num w-full max-w-0 text-ink-3">
                  <span className="block truncate" title={s.model ?? undefined}>
                    {s.model ?? (s.up ? '—' : 'down')}
                  </span>
                </Td>
                <Td right className="num @max-[28rem]:hidden">
                  {fmtCtx(s.contextLength)}
                </Td>
                <Td right className="num">
                  {s.slotsTotal !== null ? `${s.slotsBusy}/${s.slotsTotal}` : '—'}
                </Td>
                <Td right className="num @max-[28rem]:hidden">
                  {s.latencyMs !== null ? `${s.latencyMs}ms` : '—'}
                </Td>
                <Td right>
                  {s.cpuPct !== null ? (
                    <span className="num font-semibold" style={{ color: loadTone(s.cpuPct) }}>
                      {s.cpuPct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="num text-ink-3">—</span>
                  )}
                </Td>
                <Td right className="num">
                  {s.memBytes !== null ? fmtBytes(s.memBytes) : '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── System info ────────────────────────────────────────────────────── */

export function SystemCard({ className, i, system }: CardBase & { system: SystemInfo | null }) {
  const rows: Array<[string, string]> = system
    ? [
        ['Hostname', system.hostname],
        ['OS', system.os],
        ['Kernel', system.kernel],
        ['CPU', `${system.cpuModel} ×${system.cores}`],
        ['Memory', `${fmtGB(system.memTotal)} GB`],
        ['IP', system.ip ?? '—'],
      ]
    : [];

  return (
    <Card i={i} className={className}>
      <CardHead
        title="System"
        icon={<InfoIcon color="var(--accent)" />}
        right={
          system && <span className="num text-[10.5px] text-ink-3">v{system.agentVersion}</span>
        }
      />
      <div>
        {rows.map(([k, v], idx) => (
          <div
            key={k}
            className={`flex items-center gap-2 py-[3px] text-[11px] ${idx ? 'border-t border-line' : ''}`}
          >
            <span className="flex-1 text-ink-2">{k}</span>
            <span className="num max-w-[60%] truncate" title={v}>
              {v}
            </span>
          </div>
        ))}
        {!system && <span className="text-[11px] text-ink-3">Loading…</span>}
      </div>
    </Card>
  );
}
