const KB = 1024;
const MB = 1024 ** 2;
const GB = 1024 ** 3;
const TB = 1024 ** 4;

export function fmtBytes(b: number): string {
  if (!Number.isFinite(b) || b < 0) return '—';
  if (b >= TB) return `${(b / TB).toFixed(1)} TB`;
  if (b >= GB) return `${(b / GB).toFixed(1)} GB`;
  if (b >= MB) return `${Math.round(b / MB)} MB`;
  if (b >= KB) return `${Math.round(b / KB)} KB`;
  return `${Math.round(b)} B`;
}

export function fmtGB(b: number, digits = 0): string {
  return (b / GB).toFixed(digits);
}

/** Network rate: bytes/s → human string ("4.2 MB/s") */
export function fmtRate(bps: number): string {
  if (!Number.isFinite(bps) || bps < 0) return '—';
  if (bps >= GB) return `${(bps / GB).toFixed(1)} GB/s`;
  if (bps >= MB) return `${(bps / MB).toFixed(1)} MB/s`;
  if (bps >= KB) return `${Math.round(bps / KB)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

/** bytes/s → MB/s number (for chart scales) */
export const toMBs = (bps: number): number => bps / MB;

export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** "3h ago" style for exited containers */
export function fmtAgo(ts: number): string {
  const sec = Math.max(0, (Date.now() - ts) / 1000);
  if (sec >= 86400) return `${Math.floor(sec / 86400)}d ago`;
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.max(1, Math.floor(sec / 60))}m ago`;
}

/** Round a chart maximum up to a "nice" value (1/2/5 × 10^k) */
export function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  const m = v / base;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return nice * base;
}
