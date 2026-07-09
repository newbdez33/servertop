import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import si from 'systeminformation';
import type { Systeminformation } from 'systeminformation';
import { config } from './config.js';
import type {
  ContainerInfo,
  DiskMetrics,
  MetricsSnapshot,
  NetMetrics,
  ProcessInfo,
  SystemInfo,
} from '../../shared/types.js';

const PSEUDO_FS = new Set([
  'tmpfs', 'devtmpfs', 'devfs', 'overlay', 'squashfs', 'proc', 'sysfs',
  'cgroup', 'cgroup2', 'autofs', 'efivarfs', 'nullfs', 'ramfs', 'vfat',
]);

const round1 = (n: number): number => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);

const logErr = (err: unknown): void => {
  console.error('[servertop] sample error:', err instanceof Error ? err.message : err);
};

/** Rewrites Docker bind-mount paths back to host paths and drops pseudo filesystems. */
export function mapDisks(
  raw: Systeminformation.FsSizeData[],
  hostRoot: string | null,
): DiskMetrics[] {
  let entries = raw.filter(d => {
    if (PSEUDO_FS.has((d.type || '').toLowerCase())) return false;
    if (!d.size || d.size <= 0) return false;
    return true;
  });

  if (hostRoot) {
    entries = entries
      .filter(d => d.mount === hostRoot || d.mount.startsWith(`${hostRoot}/`))
      .map(d => ({ ...d, mount: d.mount === hostRoot ? '/' : d.mount.slice(hostRoot.length) }));
  } else {
    entries = entries.filter(d => {
      if (d.mount === '/') return true;
      if (d.size < 2 * 1024 ** 3) return false;
      // macOS (dev machine) system snapshot noise
      if (d.mount.startsWith('/System/Volumes/') && d.mount !== '/System/Volumes/Data') return false;
      if (d.mount.startsWith('/private/var/vm')) return false;
      return true;
    });
  }

  // De-duplicate by device, keeping the shortest mount path
  const byDev = new Map<string, Systeminformation.FsSizeData>();
  for (const d of entries) {
    const cur = byDev.get(d.fs);
    if (!cur || d.mount.length < cur.mount.length) byDev.set(d.fs, d);
  }

  return [...byDev.values()]
    .sort((a, b) => a.mount.localeCompare(b.mount))
    .map(d => ({
      mount: d.mount,
      fs: d.fs,
      type: d.type,
      size: d.size,
      used: d.used,
      usedPct: round1(d.use),
    }));
}

/**
 * Samples host metrics on three cadences:
 *  - fast   (SAMPLE_INTERVAL): CPU, memory, network
 *  - medium (5s):              processes, docker containers
 *  - slow   (10s):             disk usage, CPU temperature
 */
export class Collector extends EventEmitter {
  snapshot: MetricsSnapshot | null = null;
  processes: ProcessInfo[] = [];
  containers: ContainerInfo[] = [];
  dockerAvailable = false;
  system: SystemInfo | null = null;

  private disks: DiskMetrics[] = [];
  private tempC: number | null = null;
  private defaultIface = '';
  private timers: NodeJS.Timeout[] = [];

  async start(): Promise<void> {
    this.dockerAvailable = fs.existsSync('/var/run/docker.sock');
    await this.initSystemInfo();
    await this.sampleSlow().catch(logErr);
    await this.sampleFast().catch(logErr); // also primes network-rate deltas
    await Promise.all([
      this.sampleProcesses().catch(logErr),
      this.sampleContainers().catch(logErr),
    ]);

    this.timers = [
      setInterval(() => void this.sampleFast().catch(logErr), config.sampleIntervalMs),
      setInterval(() => void this.sampleProcesses().catch(logErr), 5_000),
      setInterval(() => void this.sampleContainers().catch(logErr), 5_000),
      setInterval(() => void this.sampleSlow().catch(logErr), 10_000),
    ];
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private readHostFile(rel: string): string | null {
    if (!config.hostRoot) return null;
    try {
      return fs.readFileSync(`${config.hostRoot}${rel}`, 'utf8').trim() || null;
    } catch {
      return null;
    }
  }

  private async initSystemInfo(): Promise<void> {
    const [osInfo, cpu, mem] = await Promise.all([si.osInfo(), si.cpu(), si.mem()]);
    let ip: string | null = null;
    try {
      this.defaultIface = await si.networkInterfaceDefault();
      const ifaces = await si.networkInterfaces();
      const list = Array.isArray(ifaces) ? ifaces : [ifaces];
      ip = list.find(i => i.iface === this.defaultIface)?.ip4 || null;
    } catch {
      /* ip stays null */
    }
    this.system = {
      hostname: this.readHostFile('/etc/hostname') ?? osInfo.hostname ?? os.hostname(),
      os: `${osInfo.distro} ${osInfo.release}`.trim(),
      kernel: osInfo.kernel,
      cpuModel: `${cpu.manufacturer} ${cpu.brand}`.trim(),
      cores: cpu.cores,
      memTotal: mem.total,
      ip,
      dockerAvailable: this.dockerAvailable,
      agentVersion: config.agentVersion,
      sampleIntervalMs: config.sampleIntervalMs,
    };
  }

  private async sampleFast(): Promise<void> {
    const [load, mem, netRaw] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.networkStats('*'),
    ]);
    const loadavg = os.loadavg();
    const net: NetMetrics[] = netRaw
      .filter(n => n.iface !== 'lo' && n.iface !== 'lo0')
      .map(n => ({
        iface: n.iface,
        rxSec: Math.max(0, n.rx_sec ?? 0),
        txSec: Math.max(0, n.tx_sec ?? 0),
        rxTotal: n.rx_bytes,
        txTotal: n.tx_bytes,
      }))
      .sort((a, b) =>
        a.iface === this.defaultIface ? -1 : b.iface === this.defaultIface ? 1 : 0,
      );

    const snapshot: MetricsSnapshot = {
      ts: Date.now(),
      cpu: {
        usage: round1(load.currentLoad),
        perCore: load.cpus.map(c => round1(c.load)),
        load: [loadavg[0] ?? 0, loadavg[1] ?? 0, loadavg[2] ?? 0],
        tempC: this.tempC,
      },
      mem: {
        total: mem.total,
        used: mem.active,
        cached: Math.max(0, mem.buffcache ?? 0),
        free: mem.free,
        swapTotal: mem.swaptotal,
        swapUsed: mem.swapused,
      },
      net,
      disk: this.disks,
      uptimeSec: Math.round(os.uptime()),
    };
    this.snapshot = snapshot;
    this.emit('metrics', snapshot);
  }

  private async sampleProcesses(): Promise<void> {
    const data = await si.processes();
    const byCpu = [...data.list].sort((a, b) => b.cpu - a.cpu).slice(0, 12);
    const byMem = [...data.list].sort((a, b) => b.mem - a.mem).slice(0, 12);
    const memTotal = this.system?.memTotal ?? 0;
    const seen = new Set<number>();
    const merged: ProcessInfo[] = [];
    for (const p of [...byCpu, ...byMem]) {
      if (seen.has(p.pid)) continue;
      seen.add(p.pid);
      merged.push({
        pid: p.pid,
        name: p.name,
        user: p.user || '',
        cpu: round1(p.cpu),
        memBytes: Math.round((p.mem / 100) * memTotal),
      });
    }
    this.processes = merged;
    this.emit('processes', merged);
  }

  private async sampleContainers(): Promise<void> {
    if (!this.dockerAvailable) return;
    try {
      const list = await si.dockerContainers(true);
      const stats = await si.dockerContainerStats('*');
      const statById = new Map(stats.map(s => [s.id, s]));
      const containers: ContainerInfo[] = list.map(c => {
        const s = statById.get(c.id);
        return {
          id: c.id.slice(0, 12),
          name: c.name,
          image: c.image,
          state: c.state,
          cpuPct: s ? round1(s.cpuPercent) : null,
          memBytes: s ? Math.round(s.memUsage) : null,
          // created-but-never-started containers report a far-past epoch
          startedAt: c.started > 0 ? c.started * 1000 : null,
        };
      });
      this.containers = containers;
      this.emit('containers', containers);
    } catch (err) {
      logErr(err);
    }
  }

  private async sampleSlow(): Promise<void> {
    const [fsSizes, temp] = await Promise.all([si.fsSize(), si.cpuTemperature()]);
    this.disks = mapDisks(fsSizes, config.hostRoot);
    this.tempC = temp.main && temp.main > 0 ? round1(temp.main) : null;
  }
}
