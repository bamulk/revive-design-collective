"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  Clock,
  Archive,
  CheckCircle2,
  XCircle,
  MapPin,
} from "lucide-react";
import { formatMDY } from "@/lib/time";

type Status = "scheduled" | "staged" | "destaged" | "completed" | "cancelled";

export type PortalPayment = {
  id: string;
  amount: number | null;
  paid_at: string;
  method: string | null;
};
export type PortalExtension = {
  id: string;
  extension_date: string;
  amount: number | null;
  paid_at: string | null;
};
export type PortalCard = {
  id: string;
  address: string;
  city: string | null;
  status: Status;
  stage_date: string | null;
  destage_date: string | null;
  amount: number | null;
  paid_at: string | null;
  paidSoFar: number;
  outstanding: number;
  paymentState: "paid" | "partial" | "unpaid";
  payments: PortalPayment[];
  exts: PortalExtension[];
};

const STATUS_META: Record<
  Status,
  { label: string; tone: string; Icon: React.ComponentType<{ size?: number }> }
> = {
  scheduled: {
    label: "Upcoming",
    tone: "bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:ring-blue-900/60",
    Icon: Calendar,
  },
  staged: {
    label: "Staged",
    tone: "bg-orange-100 text-orange-800 ring-orange-200 dark:bg-orange-950/50 dark:text-orange-200 dark:ring-orange-900/60",
    Icon: Clock,
  },
  destaged: {
    label: "Destaged",
    tone: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900/60",
    Icon: Archive,
  },
  completed: {
    label: "Completed",
    tone: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700",
    Icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    tone: "bg-rose-100 text-rose-700 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:ring-rose-900/60",
    Icon: XCircle,
  },
};

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

type Filter = "all" | "paid" | "unpaid";

export default function PortalStagesList({ cards }: { cards: PortalCard[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    let paid = 0;
    let unpaid = 0;
    for (const c of cards) {
      if (c.status === "cancelled") continue;
      if (c.paymentState === "paid") paid++;
      else unpaid++;
    }
    return { all: cards.length, paid, unpaid };
  }, [cards]);

  const visible = cards.filter((c) => {
    if (filter === "paid") return c.paymentState === "paid";
    if (filter === "unpaid")
      return c.status !== "cancelled" && c.paymentState !== "paid";
    return true;
  });

  return (
    <div className="space-y-3">
      <FilterChips filter={filter} setFilter={setFilter} counts={counts} />

      {visible.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-600 dark:text-slate-400">
          No {filter === "all" ? "" : filter} stages.
        </div>
      ) : (
        visible.map((s) => {
          const meta = STATUS_META[s.status] ?? STATUS_META.scheduled;
          const Icon = meta.Icon;
          return (
            <div
              key={s.id}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
            >
              <div className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {s.address}
                    </div>
                    {s.city && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1 mt-0.5">
                        <MapPin size={11} /> {s.city}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ring-inset ${meta.tone}`}
                  >
                    <Icon size={12} /> {meta.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <Cell label="Stage date">
                    {s.stage_date ? formatMDY(s.stage_date) : "TBD"}
                  </Cell>
                  <Cell label="Destage date">
                    {s.destage_date ? formatMDY(s.destage_date) : "TBD"}
                  </Cell>
                  <Cell label="Amount">
                    {s.amount != null ? fmtMoney(Number(s.amount)) : "—"}
                  </Cell>
                  <Cell label="Payment">
                    {s.paymentState === "paid" && (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 size={12} /> Paid
                        {s.paid_at && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {formatMDY(s.paid_at)}
                          </span>
                        )}
                      </span>
                    )}
                    {s.paymentState === "partial" && (
                      <span className="inline-flex flex-col">
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                          Partially paid
                        </span>
                        <span className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                          {fmtMoney(s.paidSoFar)} paid ·{" "}
                          <span className="text-rose-700 dark:text-rose-300">
                            {fmtMoney(s.outstanding)} due
                          </span>
                        </span>
                      </span>
                    )}
                    {s.paymentState === "unpaid" && (
                      <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300">
                        Unpaid
                      </span>
                    )}
                  </Cell>
                </div>

                {s.payments.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Payment history
                    </div>
                    <ul className="space-y-1">
                      {s.payments.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="text-slate-700 dark:text-slate-300">
                            {formatMDY(p.paid_at)}
                            {p.method && (
                              <span className="ml-2 px-1.5 py-0.5 rounded text-[11px] capitalize bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                {p.method}
                              </span>
                            )}
                          </span>
                          <span className="tabular-nums font-medium text-slate-900 dark:text-slate-100">
                            {fmtMoney(Number(p.amount ?? 0))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {s.exts.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Extensions
                    </div>
                    <ul className="space-y-1.5">
                      {s.exts.map((e) => (
                        <li
                          key={e.id}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="text-slate-700 dark:text-slate-300">
                            Extended through{" "}
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                              {formatMDY(e.extension_date)}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            {e.amount != null && (
                              <span className="tabular-nums text-slate-700 dark:text-slate-300">
                                {fmtMoney(Number(e.amount))}
                              </span>
                            )}
                            {e.paid_at ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                <CheckCircle2 size={11} /> Paid
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-rose-700 dark:text-rose-300">
                                Unpaid
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export function FilterChips({
  filter,
  setFilter,
  counts,
}: {
  filter: Filter;
  setFilter: (f: Filter) => void;
  counts: { all: number; paid: number; unpaid: number };
}) {
  const chips: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "All", n: counts.all },
    { key: "unpaid", label: "Unpaid", n: counts.unpaid },
    { key: "paid", label: "Paid", n: counts.paid },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => {
        const active = filter === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition ${
              active
                ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800"
            }`}
          >
            {c.label}
            <span
              className={`text-xs tabular-nums ${
                active ? "opacity-80" : "text-slate-400 dark:text-slate-500"
              }`}
            >
              {c.n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="text-slate-900 dark:text-slate-100">{children}</div>
    </div>
  );
}
