"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Card } from "@/components/ui";
import { formatMDY } from "@/lib/time";
import QuickMarkExtensionPaid from "@/components/QuickMarkExtensionPaid";
import ResendExtensionButton from "@/components/ResendExtensionButton";

export type OutstandingExtensionRow = {
  id: string;
  stage_id: string;
  address: string;
  client_id: string | null;
  client_name: string | null;
  client_email: string | null;
  /** When the extension invoice email last went out (arms reminders). */
  pdf_sent_at: string | null;
  extension_date: string | null;
  amount: number;
  /** Automated payment reminders sent so far (0 = none yet). */
  reminder_count: number;
  reminder_last_at: string | null;
};

/** "Reminded ×2 · 7/30" once the cron has nudged this extension. */
function ReminderTrail({
  count,
  lastAt,
}: {
  count: number;
  lastAt: string | null;
}) {
  if (count <= 0) return null;
  return (
    <div className="text-[11px] text-amber-700 dark:text-amber-400">
      Reminded ×{count}
      {lastAt ? ` · ${formatMDY(lastAt.slice(0, 10))}` : ""}
    </div>
  );
}

type SortKey = "date_asc" | "date_desc" | "amount_desc" | "amount_asc" | "address";

const SORT_LABELS: Record<SortKey, string> = {
  date_asc: "Extension date — oldest first",
  date_desc: "Extension date — newest first",
  amount_desc: "Amount — high to low",
  amount_asc: "Amount — low to high",
  address: "Address (A–Z)",
};

/**
 * Outstanding-extensions section — the extensions twin of
 * OutstandingInvoicesList. Client-side search + sort over a
 * server-rendered list; each row links to its stage/client and
 * carries a quick Mark-as-paid.
 */
export default function OutstandingExtensionsList({
  rows,
}: {
  rows: OutstandingExtensionRow[];
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("date_asc");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
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
        case "date_asc":
          return compareDate(a.extension_date, b.extension_date, "asc");
        case "date_desc":
          return compareDate(a.extension_date, b.extension_date, "desc");
        case "amount_desc":
          return b.amount - a.amount;
        case "amount_asc":
          return a.amount - b.amount;
        case "address":
          return a.address.localeCompare(b.address);
      }
    });
    return sorted;
  }, [rows, query, sort]);

  const filteredTotal = visible.reduce((sum, r) => sum + r.amount, 0);
  const showingSubset = visible.length !== rows.length;

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

      {showingSubset && (
        <div className="text-xs text-slate-600 dark:text-slate-400">
          Showing {visible.length} of {rows.length} · ${" "}
          {filteredTotal.toFixed(2)} in this view
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic px-1">
          No matches.
        </p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="md:hidden space-y-2">
            {visible.map((x) => (
              <div
                key={x.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 shadow-sm space-y-2"
              >
                <Link href={`/stages/${x.stage_id}`} className="block">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {x.address}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    ${x.amount.toFixed(2)} · extension{" "}
                    {formatMDY(x.extension_date)}
                  </div>
                  <ReminderTrail
                    count={x.reminder_count}
                    lastAt={x.reminder_last_at}
                  />
                </Link>
                <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                  {x.client_id ? (
                    <Link
                      href={`/clients/${x.client_id}`}
                      className="underline decoration-dotted underline-offset-2 hover:text-brand"
                    >
                      {x.client_name ?? "Client"}
                    </Link>
                  ) : (
                    (x.client_name ?? "—")
                  )}
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <QuickMarkExtensionPaid
                    extensionId={x.id}
                    stageId={x.stage_id}
                  />
                  <ResendExtensionButton
                    extensionId={x.id}
                    clientEmail={x.client_email}
                    pdfSentAt={x.pdf_sent_at}
                  />
                </div>
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
                    <th className="p-3 font-medium">Extension date</th>
                    <th className="p-3 font-medium text-right">Amount</th>
                    <th className="p-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((x) => (
                    <tr
                      key={x.id}
                      className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/60"
                    >
                      <td className="p-3">
                        <Link
                          href={`/stages/${x.stage_id}`}
                          className="font-medium text-slate-900 dark:text-slate-100 hover:text-brand"
                        >
                          {x.address}
                        </Link>
                        <ReminderTrail
                          count={x.reminder_count}
                          lastAt={x.reminder_last_at}
                        />
                      </td>
                      <td className="p-3 text-slate-700 dark:text-slate-300">
                        {x.client_id ? (
                          <Link
                            href={`/clients/${x.client_id}`}
                            className="hover:text-brand underline decoration-dotted underline-offset-2"
                          >
                            {x.client_name ?? "Client"}
                          </Link>
                        ) : (
                          (x.client_name ?? "—")
                        )}
                      </td>
                      <td className="p-3 text-slate-700 dark:text-slate-300 tabular-nums">
                        {formatMDY(x.extension_date)}
                      </td>
                      <td className="p-3 text-right font-medium tabular-nums">
                        ${x.amount.toFixed(2)}
                      </td>
                      <td className="p-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <ResendExtensionButton
                            extensionId={x.id}
                            clientEmail={x.client_email}
                            pdfSentAt={x.pdf_sent_at}
                          />
                          <QuickMarkExtensionPaid
                            extensionId={x.id}
                            stageId={x.stage_id}
                          />
                        </div>
                      </td>
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
  // Nulls sink to the bottom regardless of direction.
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return dir === "asc" ? a.localeCompare(b) : b.localeCompare(a);
}
