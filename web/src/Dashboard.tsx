import type { ReactNode } from 'react';
import type {
  ContainerInfo,
  HistoryPoint,
  LayoutCardSpec,
  MetricsSnapshot,
  ProcessInfo,
  SystemInfo,
} from '../../shared/types';
import {
  ContainerCard,
  CpuCard,
  CpuTile,
  DiskCard,
  DiskTile,
  MemoryCard,
  MemoryTile,
  NetworkCard,
  NetworkTile,
  ProcessCard,
  SystemCard,
} from './components/cards';
import { TopBar } from './components/TopBar';
import { useLive } from './hooks/useLive';
import { DEFAULT_LAYOUT, DEFAULT_SPAN, gridClasses } from './lib/layout';

interface CardCtx {
  snapshot: MetricsSnapshot;
  history: HistoryPoint[];
  system: SystemInfo | null;
  processes: ProcessInfo[];
  containers: ContainerInfo[];
  intervalMs: number;
}

function renderCard(spec: LayoutCardSpec, idx: number, ctx: CardCtx): ReactNode {
  const key = `${spec.id}-${idx}`;
  const base = { className: gridClasses(spec.span ?? DEFAULT_SPAN[spec.id]), i: idx };
  switch (spec.id) {
    case 'cpu-tile':
      return <CpuTile key={key} {...base} snapshot={ctx.snapshot} history={ctx.history} />;
    case 'memory-tile':
      return <MemoryTile key={key} {...base} snapshot={ctx.snapshot} history={ctx.history} />;
    case 'disk-tile':
      return <DiskTile key={key} {...base} snapshot={ctx.snapshot} history={ctx.history} />;
    case 'network-tile':
      return <NetworkTile key={key} {...base} snapshot={ctx.snapshot} history={ctx.history} />;
    case 'cpu-chart':
      return (
        <CpuCard
          key={key}
          {...base}
          snapshot={ctx.snapshot}
          history={ctx.history}
          intervalMs={ctx.intervalMs}
        />
      );
    case 'network-chart':
      return (
        <NetworkCard
          key={key}
          {...base}
          snapshot={ctx.snapshot}
          history={ctx.history}
          intervalMs={ctx.intervalMs}
        />
      );
    case 'memory':
      return <MemoryCard key={key} {...base} snapshot={ctx.snapshot} />;
    case 'disk':
      return <DiskCard key={key} {...base} snapshot={ctx.snapshot} />;
    case 'system':
      return <SystemCard key={key} {...base} system={ctx.system} />;
    case 'processes':
      return <ProcessCard key={key} {...base} processes={ctx.processes} limit={spec.limit} />;
    case 'docker':
      return (
        <ContainerCard
          key={key}
          {...base}
          containers={ctx.containers}
          available={ctx.system?.dockerAvailable ?? true}
          limit={spec.limit}
        />
      );
  }
}

export function Dashboard({
  theme,
  onAuthFailed,
  canLogout,
}: {
  theme: { dark: boolean; toggle: () => void };
  onAuthFailed: () => void;
  canLogout: boolean;
}) {
  const { dark, toggle } = theme;
  const { status, system, snapshot, processes, containers, history } = useLive(onAuthFailed);
  const intervalMs = system?.sampleIntervalMs ?? 2000;
  const cards = system?.layout?.cards ?? DEFAULT_LAYOUT;

  return (
    <div className="min-h-screen">
      <TopBar
        system={system}
        snapshot={snapshot}
        status={status}
        dark={dark}
        onToggleTheme={toggle}
        onLogout={canLogout ? onAuthFailed : null}
      />

      <main className="grid grid-cols-12 gap-2 px-3 pt-2 pb-2">
        {snapshot ? (
          cards.map((spec, idx) =>
            renderCard(spec, idx, {
              snapshot,
              history,
              system,
              processes,
              containers,
              intervalMs,
            }),
          )
        ) : (
          <div className="col-span-12 grid h-60 place-items-center text-[12px] text-ink-3">
            {status === 'offline' ? 'Cannot reach the server — retrying…' : 'Connecting…'}
          </div>
        )}
      </main>
    </div>
  );
}
