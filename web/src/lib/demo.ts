import type {
  ContainerInfo,
  HistoryPoint,
  MetricsSnapshot,
  ProcessInfo,
  SystemInfo,
} from '../../../shared/types';

/** Build-time flag — set VITE_DEMO=1 to ship the simulated-data demo (GitHub Pages). */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const INTERVAL_MS = 2000;

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;

class Walk {
  constructor(
    public value: number,
    private readonly min: number,
    private readonly max: number,
    private readonly step: number,
  ) {}

  next(): number {
    this.value = clamp(this.value + (Math.random() - 0.5) * this.step, this.min, this.max);
    return this.value;
  }
}

export interface Demo {
  system: SystemInfo;
  seedHistory: () => HistoryPoint[];
  tick: () => MetricsSnapshot;
  processes: () => ProcessInfo[];
  containers: () => ContainerInfo[];
}

export function createDemo(): Demo {
  const memTotal = 16 * GB;
  const cpu = new Walk(32, 5, 95, 7);
  const memPct = new Walk(63, 55, 72, 1.2);
  const rx = new Walk(4.2 * MB, 0.2 * MB, 11 * MB, 1.5 * MB);
  const tx = new Walk(1.1 * MB, 0.05 * MB, 5 * MB, 0.6 * MB);
  const cores = Array.from({ length: 8 }, (_, i) => new Walk(15 + ((i * 11) % 40), 2, 98, 9));
  let uptimeSec = 42 * 86400 + 6 * 3600;
  let rxTotal = 927 * GB;
  let txTotal = 231 * GB;

  const system: SystemInfo = {
    hostname: 'demo-server-01',
    os: 'Ubuntu 22.04.4 LTS',
    kernel: '5.15.0-105-generic',
    cpuModel: 'Intel Xeon E5-2686 v4',
    cores: 8,
    memTotal,
    ip: '203.0.113.10',
    dockerAvailable: true,
    agentVersion: '0.1.0',
    sampleIntervalMs: INTERVAL_MS,
  };

  const disks = [
    { mount: '/', fs: '/dev/vda1', type: 'ext4', size: 472 * GB, used: 335 * GB, usedPct: 70.9 },
    { mount: '/home', fs: '/dev/vda2', type: 'ext4', size: 200 * GB, used: 88 * GB, usedPct: 44 },
    { mount: '/var', fs: '/dev/vdb1', type: 'ext4', size: 100 * GB, used: 91 * GB, usedPct: 91 },
    { mount: '/boot', fs: '/dev/vda3', type: 'ext4', size: 2 * GB, used: 0.46 * GB, usedPct: 23 },
  ];

  const baseProcs: Array<[number, string, string, number, number]> = [
    [1874, 'node', 'app', 18.4, 812 * MB],
    [1102, 'postgres', 'postgres', 12.1, 1.4 * GB],
    [981, 'redis-server', 'redis', 4.3, 210 * MB],
    [743, 'nginx', 'www-data', 3.2, 64 * MB],
    [655, 'dockerd', 'root', 2.6, 148 * MB],
    [2201, 'servertop', 'app', 1.4, 58 * MB],
    [412, 'systemd-journald', 'root', 0.8, 32 * MB],
    [890, 'sshd', 'root', 0.2, 12 * MB],
  ];

  const startOfDemo = Date.now();
  const baseContainers: ContainerInfo[] = [
    { id: 'a1b2c3d4e5f6', name: 'app-web', image: 'app:1.8.2', state: 'running', cpuPct: 14.2, memBytes: 780 * MB, startedAt: startOfDemo - 12 * 86400_000 },
    { id: 'b2c3d4e5f6a1', name: 'nginx-proxy', image: 'nginx:1.27', state: 'running', cpuPct: 2.1, memBytes: 48 * MB, startedAt: startOfDemo - 42 * 86400_000 },
    { id: 'c3d4e5f6a1b2', name: 'postgres', image: 'postgres:16', state: 'running', cpuPct: 9.8, memBytes: 1.2 * GB, startedAt: startOfDemo - 42 * 86400_000 },
    { id: 'd4e5f6a1b2c3', name: 'redis', image: 'redis:7', state: 'running', cpuPct: 1.3, memBytes: 96 * MB, startedAt: startOfDemo - 42 * 86400_000 },
    { id: 'e5f6a1b2c3d4', name: 'backup-cron', image: 'backup:0.4', state: 'exited', cpuPct: null, memBytes: null, startedAt: startOfDemo - 3 * 3600_000 },
  ];

  const snapshotAt = (ts: number): MetricsSnapshot => {
    uptimeSec += INTERVAL_MS / 1000;
    const rxSec = rx.next();
    const txSec = tx.next();
    rxTotal += rxSec * (INTERVAL_MS / 1000);
    txTotal += txSec * (INTERVAL_MS / 1000);
    const usage = round1(cpu.next());
    const used = (memPct.next() / 100) * memTotal;
    const cached = 0.19 * memTotal;
    return {
      ts,
      cpu: {
        usage,
        perCore: cores.map(c => round1(c.next())),
        load: [round1(usage / 26 + 0.4), round1(usage / 30 + 0.3), round1(usage / 34 + 0.3)],
        tempC: round1(48 + usage / 10),
      },
      mem: {
        total: memTotal,
        used,
        cached,
        free: Math.max(0, memTotal - used - cached),
        swapTotal: 2 * GB,
        swapUsed: 0.3 * GB,
      },
      net: [{ iface: 'eth0', rxSec, txSec, rxTotal, txTotal }],
      disk: disks,
      uptimeSec: Math.round(uptimeSec),
    };
  };

  return {
    system,
    seedHistory: () => {
      const now = Date.now();
      const points: HistoryPoint[] = [];
      for (let i = 89; i >= 1; i--) {
        const m = snapshotAt(now - i * INTERVAL_MS);
        points.push({
          ts: m.ts,
          cpu: m.cpu.usage,
          mem: (m.mem.used / m.mem.total) * 100,
          rx: m.net[0].rxSec,
          tx: m.net[0].txSec,
        });
      }
      return points;
    },
    tick: () => snapshotAt(Date.now()),
    processes: () =>
      baseProcs.map(([pid, name, user, cpuPct, memBytes]) => ({
        pid,
        name,
        user,
        cpu: round1(clamp(cpuPct + (Math.random() - 0.5) * cpuPct * 0.4, 0.1, 99)),
        memBytes,
      })),
    containers: () =>
      baseContainers.map(c =>
        c.state === 'running' && c.cpuPct !== null
          ? { ...c, cpuPct: round1(clamp(c.cpuPct + (Math.random() - 0.5) * 2, 0.1, 99)) }
          : c,
      ),
  };
}
