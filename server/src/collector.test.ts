import assert from 'node:assert/strict';
import test from 'node:test';
import type { Systeminformation } from 'systeminformation';
import { mapDisks } from './collector.js';

const GB = 1024 ** 3;
const fsEntry = (
  mount: string,
  size: number,
  usedPct: number,
): Systeminformation.FsSizeData => ({
  fs: `/dev/${mount.replace(/[^a-z0-9]/gi, '') || 'root'}`,
  type: 'apfs',
  size,
  used: Math.round((size * usedPct) / 100),
  available: Math.round((size * (100 - usedPct)) / 100),
  use: usedPct,
  mount,
  rw: true,
});

test('mapDisks drops iOS Simulator runtime volumes mounted by cryptexd', () => {
  const raw = [
    fsEntry('/', 500 * GB, 8),
    fsEntry('/Volumes/shit', 1000 * GB, 6),
    fsEntry(
      '/private/var/run/com.apple.security.cryptexd/mnt/com.apple.iPhoneOS.SimulatorRuntime-v24.1.434.0.5x7s4d',
      8 * GB,
      98,
    ),
  ];
  const mounts = mapDisks(raw, null).map(d => d.mount);
  assert.ok(mounts.includes('/Volumes/shit'));
  assert.ok(!mounts.some(m => m.includes('cryptexd')), `simulator volume leaked: ${mounts.join(', ')}`);
});
