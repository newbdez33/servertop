import {
  ContainerCard,
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

      <main className="grid grid-cols-12 gap-2 px-3 pt-2 pb-2">
        {snapshot ? (
          <>
            <StatTiles snapshot={snapshot} history={history} />
            <CpuCard snapshot={snapshot} history={history} intervalMs={intervalMs} />
            <NetworkCard snapshot={snapshot} history={history} intervalMs={intervalMs} />
            <MemoryCard snapshot={snapshot} />
            <DiskCard snapshot={snapshot} />
            <SystemCard system={system} />
            <ProcessCard processes={processes} />
            <ContainerCard containers={containers} available={system?.dockerAvailable ?? true} />
          </>
        ) : (
          <div className="col-span-12 grid h-60 place-items-center text-[12px] text-ink-3">
            {status === 'offline' ? 'Cannot reach the server — retrying…' : 'Connecting…'}
          </div>
        )}
      </main>
    </div>
  );
}
