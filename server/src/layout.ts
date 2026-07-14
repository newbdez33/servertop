import fs from 'node:fs';
import type { CardId, DashboardLayout, LayoutCardSpec } from '../../shared/types.js';

const CARD_IDS = new Set<CardId>([
  'cpu-tile',
  'memory-tile',
  'disk-tile',
  'network-tile',
  'cpu-chart',
  'network-chart',
  'memory',
  'disk',
  'system',
  'processes',
  'docker',
  'claude',
  'codex',
]);

/**
 * Loads the optional dashboard layout JSON. Accepts `{"cards": [...]}` or a
 * bare array; entries are card-id strings or `{id, span?, limit?}` objects.
 * Any problem falls back to null (client default layout) — never crashes.
 */
export function loadLayout(file: string): DashboardLayout | null {
  if (!fs.existsSync(file)) return null;
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw as { cards?: unknown })?.cards;
    if (!Array.isArray(list)) throw new Error('expected {"cards": [...]} or a top-level array');

    const cards: LayoutCardSpec[] = [];
    for (const entry of list) {
      const spec = (typeof entry === 'string' ? { id: entry } : entry) as {
        id?: unknown;
        span?: unknown;
        limit?: unknown;
      } | null;
      if (!spec || typeof spec.id !== 'string' || !CARD_IDS.has(spec.id as CardId)) {
        console.warn(`[servertop] layout: skipping unknown card ${JSON.stringify(entry)}`);
        continue;
      }
      const out: LayoutCardSpec = { id: spec.id as CardId };
      if (typeof spec.span === 'number' && Number.isFinite(spec.span)) {
        out.span = Math.min(12, Math.max(1, Math.round(spec.span)));
      }
      if (typeof spec.limit === 'number' && Number.isFinite(spec.limit)) {
        out.limit = Math.min(50, Math.max(1, Math.round(spec.limit)));
      }
      cards.push(out);
    }
    if (cards.length === 0) throw new Error('no valid cards');
    console.log(`[servertop] layout: ${cards.length} card(s) from ${file}`);
    return { cards };
  } catch (err) {
    console.warn(
      `[servertop] layout: ignoring ${file} (${err instanceof Error ? err.message : String(err)}) — using default layout`,
    );
    return null;
  }
}
