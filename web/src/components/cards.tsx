import { useState } from 'react';
import type {
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
  DiskIcon,
  InfoIcon,
  MemIcon,
  NetIcon,
} from './icons';
import { Sparkline } from './Sparkline';
import { TimeChart } from './TimeChart';
import { BarRow, Card, CardHead, Dot, Swatch } from './ui';

const MB = 1024 ** 2;

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

export function StatTiles({
  snapshot,
  history,
}: {
  snapshot: MetricsSnapshot;
  history: HistoryPoint[];
}) {
  const { cpu, mem, disk, net } = snapshot;
  const primary = net[0];
  const rootDisk = disk.find(d => d.mount === '/') ?? disk[0];
  const memPct = mem.total ? (mem.used / mem.total) * 100 : 0;
  const spark = (sel: (h: HistoryPoint) => number): number[] => history.slice(-30).map(sel);

  return (
    <>
      <Tile
        i={0}
        label="CPU"
        icon={<CpuIcon size={13} color="var(--cpu)" />}
        value={cpu.usage.toFixed(1)}
        unit="%"
        ctx={
          <>
            <span className="num">{cpu.perCore.length}</span> cores · load{' '}
            <span className="num">{cpu.load[0].toFixed(2)}</span>
          </>
        }
        values={spark(h => h.cpu)}
        color="var(--cpu)"
      />
      <Tile
        i={1}
        label="Memory"
        icon={<MemIcon size={13} color="var(--mem)" />}
        value={memPct.toFixed(1)}
        unit="%"
        ctx={
          <>
            <span className="num">{fmtGB(mem.used, 1)}</span> /{' '}
            <span className="num">{fmtGB(mem.total)}</span> GB used
          </>
        }
        values={spark(h => h.mem)}
        color="var(--mem)"
      />
      <Tile
        i={2}
        label={rootDisk ? `Disk ${rootDisk.mount}` : 'Disk'}
        icon={<DiskIcon size={13} color="var(--disk)" />}
        value={rootDisk ? rootDisk.usedPct.toFixed(1) : '—'}
        unit="%"
        ctx={
          rootDisk ? (
            <>
              <span className="num">{fmtGBdec(rootDisk.used)}</span> /{' '}
              <span className="num">{fmtGBdec(rootDisk.size)}</span> GB used
            </>
          ) : (
            'no data'
          )
        }
        values={[]}
        color="var(--disk)"
      />
      <Tile
        i={3}
        label="Network"
        icon={<NetIcon size={13} color="var(--net-rx)" />}
        value={`↓${primary ? fmtRate(primary.rxSec).replace(/ /, ' ') : '—'}`}
        unit=""
        small
        ctx={
          <>
            up ↑ <span className="num">{primary ? fmtRate(primary.txSec) : '—'}</span>
            {primary ? ` · ${primary.iface}` : ''}
          </>
        }
        values={spark(h => toMBs(h.rx))}
        color="var(--net-rx)"
      />
    </>
  );
}

function Tile({
  i,
  label,
  icon,
  value,
  unit,
  ctx,
  values,
  color,
  small = false,
}: {
  i: number;
  label: string;
  icon: React.ReactNode;
  value: string;
  unit: string;
  ctx: React.ReactNode;
  values: number[];
  color: string;
  small?: boolean;
}) {
  return (
    <Card i={i} className="col-span-12 flex flex-col gap-1 sm:col-span-6 lg:col-span-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
        {icon}
        {label}
      </span>
      <div className="flex items-end justify-between gap-2">
        <span
          className={`num font-semibold leading-none tracking-tight ${small ? 'text-[15px]' : 'text-[19px]'}`}
        >
          {value}
          {unit && <small className="text-[11px] font-medium text-ink-3">{unit}</small>}
        </span>
        <Sparkline values={values} color={color} />
      </div>
      <span className="text-[10.5px] text-ink-3">{ctx}</span>
    </Card>
  );
}

/* ── CPU ────────────────────────────────────────────────────────────── */

export function CpuCard({
  snapshot,
  history,
  intervalMs,
}: {
  snapshot: MetricsSnapshot;
  history: HistoryPoint[];
  intervalMs: number;
}) {
  return (
    <Card i={4} className="col-span-12 lg:col-span-6">
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

export function MemoryCard({ snapshot }: { snapshot: MetricsSnapshot }) {
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
    <Card i={6} className="col-span-12 md:col-span-6 lg:col-span-4">
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
  snapshot,
  history,
  intervalMs,
}: {
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
    <Card i={5} className="col-span-12 lg:col-span-6">
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

export function DiskCard({ snapshot }: { snapshot: MetricsSnapshot }) {
  const disks = snapshot.disk;
  const alerts = disks.filter(d => d.usedPct > 85);
  return (
    <Card i={7} className="col-span-12 md:col-span-6 lg:col-span-4">
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

export function ProcessCard({ processes }: { processes: ProcessInfo[] }) {
  const [sort, setSort] = useState<'cpu' | 'mem'>('cpu');
  const rows = [...processes]
    .sort((a, b) => (sort === 'cpu' ? b.cpu - a.cpu : b.memBytes - a.memBytes))
    .slice(0, 6);

  return (
    <Card i={9} className="col-span-12 lg:col-span-6">
      <CardHead
        title="Processes"
        icon={<ActivityIcon color="var(--cpu)" />}
        sub={`Top 6 by ${sort === 'cpu' ? 'CPU' : 'memory'}`}
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
              <Th>User</Th>
              <Th right>CPU</Th>
              <Th right>Mem</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.pid} className="hover:bg-surface-2">
                <Td className="num text-ink-3">{p.pid}</Td>
                <Td className="font-semibold">{p.name}</Td>
                <Td className="text-ink-3">{p.user}</Td>
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

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`border-b border-line px-2 py-0.5 text-[10px] font-semibold tracking-wider whitespace-nowrap text-ink-3 uppercase ${right ? 'text-right' : 'text-left'}`}
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

const MAX_CONTAINERS = 6;

export function ContainerCard({
  containers,
  available,
}: {
  containers: ContainerInfo[];
  available: boolean;
}) {
  const running = containers.filter(c => c.state === 'running').length;
  // Running containers first, capped for a compact single-screen layout
  const visible = [...containers]
    .sort((a, b) =>
      a.state === b.state ? a.name.localeCompare(b.name) : a.state === 'running' ? -1 : 1,
    )
    .slice(0, MAX_CONTAINERS);
  const hidden = containers.length - visible.length;
  return (
    <Card i={10} className="col-span-12 lg:col-span-6">
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
                <Th>Image</Th>
                <Th>Status</Th>
                <Th right>CPU</Th>
                <Th right>Mem</Th>
                <Th right>Uptime</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map(c => (
                <tr key={c.id} className="hover:bg-surface-2">
                  <Td className="font-semibold">{c.name}</Td>
                  <Td className="num text-ink-3">
                    <span className="block max-w-[11rem] truncate" title={c.image}>
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
                  <Td right className="num text-ink-3">
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

/* ── System info ────────────────────────────────────────────────────── */

export function SystemCard({ system }: { system: SystemInfo | null }) {
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
    <Card i={8} className="col-span-12 md:col-span-6 lg:col-span-4">
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
