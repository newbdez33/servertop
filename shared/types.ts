/**
 * Data contracts shared between the server (producer) and the web UI (consumer).
 * Type-only module — imports of this file are erased at compile time.
 */

export interface CpuMetrics {
  /** Total CPU usage, percent 0–100 */
  usage: number;
  /** Per-core usage, percent 0–100 */
  perCore: number[];
  /** 1 / 5 / 15 minute load averages */
  load: [number, number, number];
  /** CPU temperature in °C, null when the sensor is unavailable */
  tempC: number | null;
}

export interface MemMetrics {
  /** All byte values */
  total: number;
  /** Actively used memory (excludes cache/buffers) */
  used: number;
  /** Cache + buffers */
  cached: number;
  free: number;
  swapTotal: number;
  swapUsed: number;
}

export interface NetMetrics {
  iface: string;
  /** bytes per second */
  rxSec: number;
  txSec: number;
  /** total bytes since boot */
  rxTotal: number;
  txTotal: number;
}

export interface DiskMetrics {
  /** Host mount point (already rewritten from /host/... inside Docker) */
  mount: string;
  fs: string;
  type: string;
  /** bytes */
  size: number;
  used: number;
  /** percent 0–100 */
  usedPct: number;
}

export interface MetricsSnapshot {
  /** epoch ms */
  ts: number;
  cpu: CpuMetrics;
  mem: MemMetrics;
  /** First entry is the default interface */
  net: NetMetrics[];
  disk: DiskMetrics[];
  uptimeSec: number;
}

/** Slim point stored in the in-memory history ring buffer */
export interface HistoryPoint {
  ts: number;
  /** CPU usage percent */
  cpu: number;
  /** Memory used percent */
  mem: number;
  /** Default-interface rates, bytes per second */
  rx: number;
  tx: number;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  user: string;
  /** percent */
  cpu: number;
  memBytes: number;
}

export interface ContainerInfo {
  /** short id (12 chars) */
  id: string;
  name: string;
  image: string;
  /** running | exited | ... */
  state: string;
  /** null when stats are unavailable (e.g. container not running) */
  cpuPct: number | null;
  memBytes: number | null;
  /** epoch ms, null when unknown */
  startedAt: number | null;
}

export interface SystemInfo {
  hostname: string;
  os: string;
  kernel: string;
  cpuModel: string;
  /** logical cores */
  cores: number;
  memTotal: number;
  ip: string | null;
  dockerAvailable: boolean;
  agentVersion: string;
  sampleIntervalMs: number;
}

export type WsMessage =
  | { type: 'metrics'; data: MetricsSnapshot }
  | { type: 'processes'; data: ProcessInfo[] }
  | { type: 'containers'; data: ContainerInfo[] };
