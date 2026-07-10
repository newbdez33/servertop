import type { CardId, LayoutCardSpec } from '../../../shared/types';

/** Rendered when the server provides no layout (file absent / demo mode) */
export const DEFAULT_LAYOUT: LayoutCardSpec[] = [
  { id: 'cpu-tile' },
  { id: 'memory-tile' },
  { id: 'disk-tile' },
  { id: 'network-tile' },
  { id: 'cpu-chart' },
  { id: 'network-chart' },
  { id: 'memory' },
  { id: 'disk' },
  { id: 'system' },
  { id: 'processes' },
  { id: 'docker' },
];

export const DEFAULT_SPAN: Record<CardId, number> = {
  'cpu-tile': 3,
  'memory-tile': 3,
  'disk-tile': 3,
  'network-tile': 3,
  'cpu-chart': 6,
  'network-chart': 6,
  memory: 4,
  disk: 4,
  system: 4,
  processes: 6,
  docker: 6,
};

// Literal class names so Tailwind's scanner generates them
const LG_SPAN: Record<number, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
  6: 'lg:col-span-6',
  7: 'lg:col-span-7',
  8: 'lg:col-span-8',
  9: 'lg:col-span-9',
  10: 'lg:col-span-10',
  11: 'lg:col-span-11',
  12: 'lg:col-span-12',
};

/** Full width on phones; small cards go 2-up on tablets; configured span on desktop */
export function gridClasses(span: number): string {
  const clamped = Math.min(12, Math.max(1, Math.round(span)));
  const mid = clamped <= 3 ? 'sm:col-span-6' : clamped <= 4 ? 'md:col-span-6' : '';
  return ['col-span-12', mid, LG_SPAN[clamped]].filter(Boolean).join(' ');
}
