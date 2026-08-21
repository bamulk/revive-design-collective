"use client";

import { useMemo, useRef, useState } from "react";

export type ChartPoint = { month: string; days: number };

/** "2026-07" -> "Jul 26" */
function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const names = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  return `${names[(mo ?? 1) - 1]} ${String(y).slice(2)}`;
}

const W = 720;
const H = 220;
const PAD = { top: 12, right: 44, bottom: 24, left: 30 };

/**
 * Two-series line chart: Sacramento-metro median days to pending
 * (Zillow) vs our staged homes' staged→pending days. One y-axis (both
 * are days), zero-based so magnitude reads honestly. Hover shows a
 * crosshair + tooltip for the nearest month. Colors are a validated
 * CVD-safe pair (indigo / brand gold); identity is carried by the
 * legend + end labels, never color alone.
 */
export default function MarketDomChart({
  market,
  ours,
}: {
  market: ChartPoint[];
  ours: ChartPoint[];
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const months = market.map((p) => p.month);
  const oursByMonth = useMemo(
    () => new Map(ours.map((p) => [p.month, p.days])),
    [ours],
  );
  const maxDays = Math.max(
    10,
    ...market.map((p) => p.days),
    ...ours.map((p) => p.days),
  );
  const yMax = Math.ceil((maxDays * 1.15) / 5) * 5;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (months.length <= 1 ? 0 : (i / (months.length - 1)) * plotW);
  const y = (d: number) => PAD.top + plotH - (d / yMax) * plotH;

  const marketPath = market
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.days).toFixed(1)}`)
    .join("");

  // Our series is sparse (only months with a pending) — draw segments
  // between consecutive months that both have data, dots everywhere.
  const oursPts = months
    .map((m, i) => ({ i, days: oursByMonth.get(m) }))
    .filter((p): p is { i: number; days: number } => p.days != null);
  let oursPath = "";
  for (let k = 0; k < oursPts.length; k++) {
    const prev = oursPts[k - 1];
    const cur = oursPts[k];
    oursPath +=
      prev && cur.i - prev.i === 1
        ? `L${x(cur.i).toFixed(1)},${y(cur.days).toFixed(1)}`
        : `M${x(cur.i).toFixed(1)},${y(cur.days).toFixed(1)}`;
  }

  const gridVals = [0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));

  function onMove(e: React.PointerEvent) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fx = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((fx - PAD.left) / plotW) * (months.length - 1));
    setHoverIdx(Math.max(0, Math.min(months.length - 1, i)));
  }

  const hover = hoverIdx != null ? market[hoverIdx] : null;
  const hoverOurs = hover ? oursByMonth.get(hover.month) : undefined;
  const latest = market[market.length - 1];

  return (
    <div className="space-y-2">
      {/* Legend — identity never rides on color alone. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 dark:bg-indigo-400" />
          Sacramento metro — median days to pending (Zillow)
        </span>
        {oursPts.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#a9761e] dark:bg-[#d4a24a]" />
            Our staged homes — staged → pending
          </span>
        )}
      </div>

      <div
        ref={wrapRef}
        className="relative"
        onPointerMove={onMove}
        onPointerLeave={() => setHoverIdx(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto select-none"
          role="img"
          aria-label={`Sacramento median days to pending, last ${months.length} months. Latest: ${latest ? `${latest.days} days in ${monthLabel(latest.month)}` : "n/a"}.`}
        >
          {/* Recessive grid + y labels */}
          {gridVals.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(v)}
                y2={y(v)}
                className="stroke-slate-200 dark:stroke-slate-700/60"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(v) + 3}
                textAnchor="end"
                className="fill-slate-400 dark:fill-slate-500 text-[9px] tabular-nums"
              >
                {v}
              </text>
            </g>
          ))}
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(0)}
            y2={y(0)}
            className="stroke-slate-300 dark:stroke-slate-600"
            strokeWidth={1}
          />

          {/* X labels — every 3rd month */}
          {months.map((m, i) =>
            i % 3 === 0 || i === months.length - 1 ? (
              <text
                key={m}
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                className="fill-slate-400 dark:fill-slate-500 text-[9px]"
              >
                {monthLabel(m)}
              </text>
            ) : null,
          )}

          {/* Crosshair */}
          {hoverIdx != null && (
            <line
              x1={x(hoverIdx)}
              x2={x(hoverIdx)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-slate-300 dark:stroke-slate-600"
              strokeWidth={1}
            />
          )}

          {/* Market line */}
          <path
            d={marketPath}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-indigo-500 dark:stroke-indigo-400"
          />
          {/* Our line + dots */}
          {oursPath && (
            <path
              d={oursPath}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="stroke-[#a9761e] dark:stroke-[#d4a24a]"
            />
          )}
          {oursPts.map((p) => (
            <circle
              key={p.i}
              cx={x(p.i)}
              cy={y(p.days)}
              r={3}
              className="fill-[#a9761e] dark:fill-[#d4a24a]"
            />
          ))}

          {/* Hover markers */}
          {hover && (
            <circle
              cx={x(hoverIdx!)}
              cy={y(hover.days)}
              r={4}
              className="fill-indigo-500 dark:fill-indigo-400 stroke-white dark:stroke-slate-900"
              strokeWidth={2}
            />
          )}
          {hover && hoverOurs != null && (
            <circle
              cx={x(hoverIdx!)}
              cy={y(hoverOurs)}
              r={4}
              className="fill-[#a9761e] dark:fill-[#d4a24a] stroke-white dark:stroke-slate-900"
              strokeWidth={2}
            />
          )}

          {/* Direct label at the latest market point */}
          {latest && (
            <text
              x={W - PAD.right + 6}
              y={y(latest.days) + 3}
              className="fill-indigo-600 dark:fill-indigo-300 text-[10px] font-semibold tabular-nums"
            >
              {latest.days}d
            </text>
          )}
        </svg>

        {/* Tooltip */}
        {hover && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -top-1 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-[11px] px-2.5 py-1.5 shadow-lg ring-1 ring-slate-700/50 whitespace-nowrap tabular-nums"
            style={{ left: `${(x(hoverIdx!) / W) * 100}%` }}
          >
            <span className="font-semibold">{monthLabel(hover.month)}</span>
            {" · "}market {hover.days}d
            {hoverOurs != null && <> · ours {hoverOurs}d</>}
          </div>
        )}
      </div>
    </div>
  );
}
