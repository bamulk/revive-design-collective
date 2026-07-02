/**
 * Inline SVG sparkline — bar variant. Renders one bar per data point,
 * scaled to the series' own peak so the shape (not the absolute
 * amount) is what jumps out. Pure server-renderable; no client JS.
 *
 *   <Sparkline values={[10, 20, 15, 30]} className="text-emerald-500" />
 *
 * Width/height default to a small inline footprint suitable for KPI
 * cards. Colors inherit from currentColor — set via Tailwind
 * `text-<color>` on the parent.
 */
export default function Sparkline({
  values,
  width = 120,
  height = 28,
  className = "",
  title,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Tooltip text shown on hover (basic accessibility hint). */
  title?: string;
}) {
  if (values.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        className={className}
        aria-hidden="true"
      />
    );
  }
  const peak = Math.max(...values, 1);
  const n = values.length;
  // Bars + 1px gaps; keep at least 1px of bar width so flat zero
  // series still render something visible.
  const gap = 1.5;
  const barW = Math.max(1, (width - gap * (n - 1)) / n);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={title ?? "trend"}
    >
      {title && <title>{title}</title>}
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(1, (v / peak) * height) : 0;
        const x = i * (barW + gap);
        const y = height - h;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            fill="currentColor"
            opacity={0.85}
            rx={0.5}
          />
        );
      })}
    </svg>
  );
}
