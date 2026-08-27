"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  Search,
  X,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { Card, StatusBadge } from "@/components/ui";
import { formatMDY } from "@/lib/time";

export type StageRow = {
  id: string;
  address: string;
  city: string | null;
  client_name: string | null;
  status: string;
  stage_date: string | null;
  destage_date: string | null;
  amount: number;
  paid_at: string | null;
};

const STATUSES = [
  { key: "scheduled", label: "Upcoming" },
  { key: "staged", label: "Staged" },
  { key: "destaged", label: "Destages" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
] as const;

type PaidFilter = "any" | "paid" | "unpaid";
type YearFilter = "all" | "this" | "last";
type SortKey =
  | "stage_date_desc"
  | "stage_date_asc"
  | "amount_desc"
  | "amount_asc"
  | "address_asc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "stage_date_desc", label: "Stage date — newest" },
  { key: "stage_date_asc", label: "Stage date — oldest" },
  { key: "amount_desc", label: "Amount — high to low" },
  { key: "amount_asc", label: "Amount — low to high" },
  { key: "address_asc", label: "Address A→Z" },
];

/**
 * Filterable, searchable list of every stage. Replaces the old flat
 * table at /stages. Filtering / sorting is fully client-side — keeps
 * the page snappy and matches the pattern used by Outstanding invoices.
 */
export default function StagesListView({
  stages,
  isAdmin,
}: {
  stages: StageRow[];
  isAdmin: boolean;
}) {
  const [query, setQuery] = useState("");
  const [statusSet, setStatusSet] = useState<Set<string>>(
    new Set(["scheduled", "staged", "destaged", "completed"]),
  );
  const [paid, setPaid] = useState<PaidFilter>("any");
  const [year, setYear] = useState<YearFilter>("all");
  const [sort, setSort] = useState<SortKey>("stage_date_desc");

  // Re-running the filter + sort over ~700 rows on every keystroke /
  // chip toggle blocks the click handler. Defer the inputs so the
  // chip's pressed state paints immediately and React schedules the
  // expensive recompute as a transition. `isPending` lets us dim the
  // table while the new view is being built.
  const deferredQuery = useDeferredValue(query);
  const deferredStatusSet = useDeferredValue(statusSet);
  const deferredPaid = useDeferredValue(paid);
  const deferredYear = useDeferredValue(year);
  const deferredSort = useDeferredValue(sort);
  const [, startTransition] = useTransition();
  const isStale =
    query !== deferredQuery ||
    statusSet !== deferredStatusSet ||
    paid !== deferredPaid ||
    year !== deferredYear ||
    sort !== deferredSort;

  const currentYear = new Date().getFullYear();

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const tokens = q ? q.split(/\s+/) : [];
    return stages.filter((s) => {
      // Status (multi-select)
      if (deferredStatusSet.size > 0 && !deferredStatusSet.has(s.status))
        return false;
      // Paid / unpaid
      if (deferredPaid === "paid" && !s.paid_at) return false;
      if (deferredPaid === "unpaid" && s.paid_at) return false;
      // Year
      if (deferredYear !== "all") {
        const want =
          deferredYear === "this"
            ? String(currentYear)
            : String(currentYear - 1);
        const d = s.stage_date ?? "";
        if (!d.startsWith(want)) return false;
      }
      // Search across address, city, client name
      if (tokens.length > 0) {
        const hay = `${s.address ?? ""} ${s.city ?? ""} ${
          s.client_name ?? ""
        }`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [
    stages,
    deferredQuery,
    deferredStatusSet,
    deferredPaid,
    deferredYear,
    currentYear,
  ]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (deferredSort) {
        case "stage_date_desc":
          return (b.stage_date ?? "").localeCompare(a.stage_date ?? "");
        case "stage_date_asc":
          // Empty dates sink to the bottom on ascending sort.
          if (!a.stage_date && !b.stage_date) return 0;
          if (!a.stage_date) return 1;
          if (!b.stage_date) return -1;
          return a.stage_date.localeCompare(b.stage_date);
        case "amount_desc":
          return b.amount - a.amount;
        case "amount_asc":
          return a.amount - b.amount;
        case "address_asc":
          return (a.address ?? "").localeCompare(b.address ?? "");
      }
    });
    return arr;
  }, [filtered, deferredSort]);

  const totalAmount = sorted.reduce((sum, s) => sum + (s.amount || 0), 0);
  const paidCount = sorted.filter((s) => s.paid_at).length;

  function toggleStatus(k: string) {
    startTransition(() => {
      setStatusSet((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      });
    });
  }

  function clearAll() {
    startTransition(() => {
      setQuery("");
      setStatusSet(new Set(["scheduled", "staged", "destaged", "completed"]));
      setPaid("any");
      setYear("all");
    });
  }

  const anyActive =
    query.trim() !== "" ||
    paid !== "any" ||
    year !== "all" ||
    statusSet.size !== 4 ||
    !["scheduled", "staged", "destaged", "completed"].every((k) =>
      statusSet.has(k),
    );

  return (
    <div className="space-y-4">
      {/* Toolbar — search + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search address, city, or client…"
            className="w-full border rounded-lg pl-8 pr-8 py-2 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <ArrowUpDown
            size={14}
            className="text-slate-500 dark:text-slate-400"
          />
          <select
            value={sort}
            onChange={(e) => {
              const v = e.target.value as SortKey;
              startTransition(() => setSort(v));
            }}
            className="border rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-slate-900"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {anyActive && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-slate-600 dark:text-slate-400 underline hover:text-slate-900 dark:hover:text-slate-100"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Filter rows */}
      <div className="space-y-2">
        {/* Status chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">
            Status
          </span>
          {STATUSES.map((s) => {
            const active = statusSet.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleStatus(s.key)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                  active
                    ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800"
                }`}
                aria-pressed={active}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Other filters in one row */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {isAdmin && (
            <Segmented
              label="Payment"
              value={paid}
              options={[
                { v: "any", label: "Any" },
                { v: "paid", label: "Paid" },
                { v: "unpaid", label: "Unpaid" },
              ]}
              onChange={(v) =>
                startTransition(() => setPaid(v as PaidFilter))
              }
            />
          )}
          <Segmented
            label="Year"
            value={year}
            options={[
              { v: "all", label: "All" },
              { v: "this", label: `${currentYear}` },
              { v: "last", label: `${currentYear - 1}` },
            ]}
            onChange={(v) =>
              startTransition(() => setYear(v as YearFilter))
            }
          />
        </div>
      </div>

      {/* Summary line */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400 border-y border-slate-100 dark:border-slate-800 py-2">
        <div className="tabular-nums">
          {sorted.length} stage{sorted.length === 1 ? "" : "s"}
          {isAdmin && (
            <>
              {" "}
              · ${totalAmount.toFixed(2)} · {paidCount} paid
            </>
          )}
        </div>
      </div>

      {/* Table — desktop. Dim slightly while the next view is being
          computed so the user gets feedback that their click landed. */}
      <Card
        className={`hidden md:block overflow-hidden transition-opacity ${
          isStale ? "opacity-60" : ""
        }`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-700/70">
              <tr className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400 text-left">
                <th className="p-3 font-medium">Address</th>
                <th className="p-3 font-medium">Client</th>
                <th className="p-3 font-medium">Stage</th>
                <th className="p-3 font-medium">Destage</th>
                <th className="p-3 font-medium">Status</th>
                {isAdmin && (
                  <th className="p-3 font-medium text-right">Amount</th>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/60"
                >
                  <td className="p-3">
                    <Link
                      href={`/stages/${s.id}`}
                      className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand"
                    >
                      {s.address}
                    </Link>
                    {s.city && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {s.city}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-slate-700 dark:text-slate-300">
                    {s.client_name ?? "—"}
                  </td>
                  <td className="p-3 text-slate-700 dark:text-slate-300 tabular-nums">
                    {formatMDY(s.stage_date)}
                  </td>
                  <td className="p-3 text-slate-700 dark:text-slate-300 tabular-nums">
                    {formatMDY(s.destage_date)}
                  </td>
                  <td className="p-3 space-x-1">
                    <StatusBadge status={s.status} />
                  </td>
                  {isAdmin && (
                    <td className="p-3 text-right tabular-nums font-medium">
                      <div>${(s.amount || 0).toFixed(2)}</div>
                      <div className="text-[10px] uppercase tracking-wide">
                        {s.paid_at ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            Paid
                          </span>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400">
                            Unpaid
                          </span>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={isAdmin ? 7 : 6}
                    className="p-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    No stages match those filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile: stacked cards */}
      <div
        className={`md:hidden space-y-2 transition-opacity ${
          isStale ? "opacity-60" : ""
        }`}
      >
        {sorted.map((s) => (
          <Link
            key={s.id}
            href={`/stages/${s.id}`}
            className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                  {s.address}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                  {[s.city, s.client_name].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              {isAdmin && (
                <div className="text-sm tabular-nums font-medium shrink-0 text-right">
                  <div>${(s.amount || 0).toFixed(0)}</div>
                  <div
                    className={`text-[10px] uppercase tracking-wide ${
                      s.paid_at
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {s.paid_at ? "Paid" : "Unpaid"}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={s.status} />
              <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-auto tabular-nums">
                {formatMDY(s.stage_date)}
              </span>
            </div>
          </Link>
        ))}
        {sorted.length === 0 && (
          <div className="text-center text-sm text-slate-500 dark:text-slate-400 italic p-6">
            No stages match those filters.
          </div>
        )}
      </div>
    </div>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { v: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
        {options.map((o, i) => {
          const active = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              className={`px-2 py-1 text-xs font-medium transition ${
                i > 0 ? "border-l border-slate-200 dark:border-slate-700" : ""
              } ${
                active
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
              aria-pressed={active}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
