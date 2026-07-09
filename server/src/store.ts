import type { HistoryPoint } from '../../shared/types.js';

/** Fixed-capacity ring buffer for metric history. Memory only — no persistence. */
export class HistoryStore {
  private buf: (HistoryPoint | undefined)[];
  private next = 0;
  private size = 0;

  constructor(private readonly capacity: number) {
    this.buf = new Array(capacity);
  }

  push(p: HistoryPoint): void {
    this.buf[this.next] = p;
    this.next = (this.next + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  /** Points within the last `seconds`, oldest first, downsampled to at most `maxPoints`. */
  range(seconds: number, maxPoints = 360): HistoryPoint[] {
    const cutoff = Date.now() - seconds * 1000;
    const out: HistoryPoint[] = [];
    for (let i = 0; i < this.size; i++) {
      const p = this.buf[(this.next - this.size + i + 2 * this.capacity) % this.capacity]!;
      if (p.ts >= cutoff) out.push(p);
    }
    if (out.length <= maxPoints) return out;
    // Sample from the newest end so the latest point is always included
    const stride = Math.ceil(out.length / maxPoints);
    const sampled: HistoryPoint[] = [];
    for (let i = out.length - 1; i >= 0; i -= stride) sampled.unshift(out[i]);
    return sampled;
  }
}
