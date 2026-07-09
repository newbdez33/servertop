export function Sparkline({
  values,
  width = 64,
  height = 26,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.15 + 0.001;
  const lo = min - pad;
  const hi = max + pad;
  const pts = values
    .map(
      (v, i) =>
        `${((width * i) / (values.length - 1)).toFixed(1)},${(
          2 + (height - 4) * (1 - (v - lo) / (hi - lo))
        ).toFixed(1)}`,
    )
    .join(' ');

  return (
    <svg width={width} height={height} aria-hidden="true" className="shrink-0">
      <polygon points={`0,${height} ${pts} ${width},${height}`} fill="var(--accent-weak)" />
      <polyline
        points={pts}
        fill="none"
        stroke="var(--series-1)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
