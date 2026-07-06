"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Card, StatusBadge } from "@/components/ui";
import { formatMDY } from "@/lib/time";
import QuickMarkPaid from "@/components/QuickMarkPaid";
import ResendInvoiceButton from "@/components/ResendInvoiceButton";

export type OutstandingRow = {
  id: string;
  address: string;
  amount: number;
  status: string;
  stage_date: string | null;
  destage_date: string | null;
  client_name: string | null;
  client_email: string | null;
  invoice_sent_at: string | null;
};

type SortKey =
  | "stage_date_asc"
  | "stage_date_desc"
  | "amount_desc"
  | "amount_asc"
  | "address";

const SORT_LABELS: Record<SortKey, string> = {
  stage_date_asc: "Stage date — oldest first",
  stage_date_desc: "Stage date — newest first",
  amount_desc: "Amount — high to low",
  amount_asc: "Amount — low to high",
  address: "Address (A–Z)",
};

/**
 * Outstanding-invoices section with client-side filter + sort.
 *
 * Hooks into the dashboard via a server-rendered list passed in as
 * props. State is purely client-side — filters don't survive a
 * page refresh, which is what we want (resetting to "show all" is
 * the expected baseline).
 */
export default function OutstandingInvoicesList({
  rows,
  isAdmin,
}: {
  rows: OutstandingRow[];
  isAdmin: boolean;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("stage_date_asc");

  // Distinct statuses present in the data — driving the dropdown so
  // we don't show an empty bucket the user can't action on.
  const availableStatuses = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.status);
    return Array.from(s);
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (statusFilter !== "all") {
      list = list.filter((r) => r.status === statusFilter);
    }
    if (q) {
      const tokens = q.split(/\s+/);
      list = list.filter((r) => {
        const hay = `${r.address} ${r.client_name ?? ""}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "stage_date_asc":
          return compareDate(a.stage_date, b.stage_date, "asc");
        case "stage_date_desc":
          return compareDate(a.stage_date, b.stage_date, "desc");
        case "amount_desc":
          return b.amount - a.amount;
        case "amount_asc":
          return a.amount - b.amount;
        case "address":
          return a.address.localeCompare(b.address);
      }
    });
    return sorted;
  }, [rows, query, statusFilter, sort]);

  const filteredTotal = visible.reduce((sum, r) => sum + r.amount, 0);
  const filteredCount = visible.length;
  const showingSubset = filteredCount !== rows.length;

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search address or client…"
            className="w-full border rounded-lg pl-8 pr-8 py-2 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          {availableStatuses.map((s) => (
            <option key={s} value={s}>
              {labelForStatus(s)}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="border rounded-lg px-3 py-2 text-sm"
          aria-label="Sort by"
        >
          {Object.entries(SORT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      {/* Filtered total — small but useful */}
      {showingSubset && (
        <div className="text-xs text-slate-600 dark:text-slate-400">
          Showing {filteredCount} of {rows.length} · ${" "}
          {filteredTotal.toFixed(2)} in this view
        </div>
      )}

      {filteredCount === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic px-1">
          No matches.
        </p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="md:hidden space-y-2">
            {visible.map((s) => (
              <div
                key={s.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm space-y-2"
              >
                <Link href={`/stages/${s.id}`} className="block">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {s.address}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                    {s.client_name ?? "—"} · ${s.amount.toFixed(2)}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {s.status} · stage {formatMDY(s.stage_date)}
                  </div>
                </Link>
                {isAdmin && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <QuickMarkPaid stageId={s.id} />
                    <ResendInvoiceButton
                      stageId={s.id}
                      clientEmail={s.client_email}
                      invoiceSentAt={s.invoice_sent_at}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <Card className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/80 text-left border-b border-slate-200 dark:border-slate-700/70">
                  <tr className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    <th className="p-3 font-medium">Address</th>
                    <th className="p-3 font-medium">Client</th>
                    <th className="p-3 font-medium">Stage date</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium text-right">Amount</th>
                    {isAdmin && (
                      <th className="p-3 font-medium text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
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
                      </td>
                      <td className="p-3 text-slate-700 dark:text-slate-300">
                        {s.client_name ?? "—"}
                      </td>
                      <td className="p-3 text-slate-700 dark:text-slate-300">
                        {formatMDY(s.stage_date)}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="p-3 text-right font-medium tabular-nums">
                        ${s.amount.toFixed(2)}
                      </td>
                      {isAdmin && (
                        <td className="p-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <ResendInvoiceButton
                              stageId={s.id}
                              clientEmail={s.client_email}
                              invoiceSentAt={s.invoice_sent_at}
                            />
                            <QuickMarkPaid stageId={s.id} />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function compareDate(
  a: string | null,
  b: string | null,
  dir: "asc" | "desc",
): number {
  // Nulls sink to the bottom regardless of direction so freshly-booked
  // stages without a date don't bury actionable rows at the top.
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return dir === "asc" ? a.localeCompare(b) : b.localeCompare(a);
}

function labelForStatus(s: string): string {
  if (s === "destaged") return "Destages";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
