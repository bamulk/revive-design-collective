"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";

/**
 * Admin-only P&L download. Year select + Export button. The anchor
 * does a real browser navigation to /api/finance/export-pl?year=YYYY
 * so the browser handles the file download natively (no JS download
 * shim, no blob URL juggling). Server enforces admin auth.
 */
export default function ExportPLButton({
  years,
  defaultYear,
}: {
  /** Sorted descending — newest year first. */
  years: number[];
  defaultYear: number;
}) {
  const [year, setYear] = useState(defaultYear);
  return (
    <div className="inline-flex items-center gap-1.5">
      <label className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 sr-only sm:not-sr-only">
        Year
      </label>
      <select
        value={year}
        onChange={(e) => setYear(Number(e.target.value))}
        className="text-sm border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-900 tabular-nums"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <a
        href={`/api/finance/export-pl?year=${year}`}
        className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        <FileDown size={14} /> Export P&amp;L
      </a>
    </div>
  );
}
