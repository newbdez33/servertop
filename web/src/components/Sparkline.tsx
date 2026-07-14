export interface SparkSeries {
  values: number[];
  color: string;
}

/** Tiny multi-series trend line. All series share one y-scale; the first
 *  series gets an area fill, later series render as lines on top of it. */
export function Sparkline({
  series,
  width = 56,
  height = 22,
}: {
  series: SparkSeries[];
  width?: number;
  height?: number;
}) {
  const all = series.flatMap(s => s.values);
  if (all.length < 2 || series.every(s => s.values.length < 2)) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }

  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.15 + 0.001;
  const lo = min - pad;
  const hi = max + pad;
  const pts = (values: number[]): string =>
    values
      .map(
        (v, i) =>
          `${((width * i) / (values.length - 1)).toFixed(1)},${(
            2 + (height - 4) * (1 - (v - lo) / (hi - lo))
          ).toFixed(1)}`,
      )
      .join(' ');

  const first = series[0];
  return (
    <svg width={width} height={height} aria-hidden="true" className="shrink-0">
      {first.values.length >= 2 && (
        <polygon
          points={`0,${height} ${pts(first.values)} ${width},${height}`}
          fill={`color-mix(in srgb, ${first.color} 14%, transparent)`}
        />
      )}
      {[...series].reverse().map((s, idx) =>
        s.values.length >= 2 ? (
          <polyline
            key={idx}
            points={pts(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        ) : null,
      )}
    </svg>
  );
}
