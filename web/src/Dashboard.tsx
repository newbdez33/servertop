import {
  ContainerCard,
  CoresCard,
  CpuCard,
  DiskCard,
  MemoryCard,
  NetworkCard,
  ProcessCard,
  StatTiles,
  SystemCard,
} from './components/cards';
import { TopBar } from './components/TopBar';
import { useLive } from './hooks/useLive';

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

      <main className="grid grid-cols-12 gap-2.5 px-4 pt-3 pb-6">
        {snapshot ? (
          <>
            <StatTiles snapshot={snapshot} history={history} />
            <CpuCard snapshot={snapshot} history={history} intervalMs={intervalMs} />
            <CoresCard snapshot={snapshot} system={system} />
            <MemoryCard snapshot={snapshot} />
            <NetworkCard snapshot={snapshot} history={history} intervalMs={intervalMs} />
            <DiskCard snapshot={snapshot} />
            <ProcessCard processes={processes} />
            <ContainerCard containers={containers} available={system?.dockerAvailable ?? true} />
            <SystemCard system={system} />
          </>
        ) : (
          <div className="col-span-12 grid h-60 place-items-center text-[12px] text-ink-3">
            {status === 'offline' ? 'Cannot reach the server — retrying…' : 'Connecting…'}
          </div>
        )}
        <p className="col-span-12 pt-1 text-center text-[11px] text-ink-3">
          Read-only view · metrics update every {(intervalMs / 1000).toFixed(0)}s over WebSocket
        </p>
      </main>
    </div>
  );
}
