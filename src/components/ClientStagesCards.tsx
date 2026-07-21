"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMDY } from "@/lib/time";
import { FilterChips } from "@/components/PortalStagesList";

export type ClientStage = {
  id: string;
  address: string;
  status: string;
  stage_date: string | null;
  destage_date: string | null;
  amount: number | null;
  paid_at: string | null;
  payment_method: string | null;
  /** Derived invoice number (INV-YYMMDD-XXXXXX); null until an invoice
   *  has been generated for the stage. */
  invoice_number?: string | null;
};

const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300",
  staged: "bg-orange-50 text-orange-800 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-300",
  destaged: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
  completed: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300",
  cancelled: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300",
};

type Filter = "all" | "paid" | "unpaid";

/** Payment classification used for both the badge and the filter. */
function paymentInfo(s: ClientStage): {
  state: "paid" | "unpaid" | "cancelled";
  label: string;
  cls: string;
} {
  if (s.status === "cancelled") {
    return { state: "cancelled", label: "—", cls: "text-slate-400 dark:text-slate-500" };
  }
  if (s.paid_at) {
    return {
      state: "paid",
      label: `Paid${s.payment_method ? ` · ${s.payment_method}` : ""}`,
      cls: "inline-flex items-center px-2 py-0.5 rounded-md ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/60",
    };
  }
  if (s.status === "scheduled") {
    return {
      state: "unpaid",
      label: "Pending stage",
      cls: "inline-flex items-center px-2 py-0.5 rounded-md ring-1 ring-inset bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
    };
  }
  return {
    state: "unpaid",
    label: "Unpaid",
    cls: "inline-flex items-center px-2 py-0.5 rounded-md ring-1 ring-inset bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/60",
  };
}

export default function ClientStagesCards({
  stages,
}: {
  stages: ClientStage[];
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    let paid = 0;
    let unpaid = 0;
    for (const s of stages) {
      const info = paymentInfo(s);
      if (info.state === "paid") paid++;
      else if (info.state === "unpaid") unpaid++;
    }
    return { all: stages.length, paid, unpaid };
  }, [stages]);

  const visible = stages.filter((s) => {
    if (filter === "all") return true;
    return paymentInfo(s).state === filter;
  });

  if (stages.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-700 dark:text-slate-300">
        No stages for this client.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <FilterChips filter={filter} setFilter={setFilter} counts={counts} />

      {visible.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-600 dark:text-slate-400">
          No {filter} stages.
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map((s) => {
            const pay = paymentInfo(s);
            return (
              <Link
                key={s.id}
                href={`/stages/${s.id}`}
                className="block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800/60 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {s.address}
                    </div>
                    {s.invoice_number && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums truncate">
                        {s.invoice_number}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset capitalize ${
                      STATUS_TONE[s.status] ?? STATUS_TONE.completed
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-3">
                  <Cell label="Stage">{formatMDY(s.stage_date)}</Cell>
                  <Cell label="Destage">{formatMDY(s.destage_date)}</Cell>
                  <Cell label="Amount">
                    <span className="tabular-nums">
                      ${Number(s.amount ?? 0).toFixed(2)}
                    </span>
                  </Cell>
                  <Cell label="Payment">
                    <span className={`text-xs ${pay.cls}`}>{pay.label}</span>
                    {s.paid_at && (
                      <span className="block text-[10px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                        {formatMDY(s.paid_at)}
                      </span>
                    )}
                  </Cell>
                </div>
              </Link>
            );
          })}
        </div>
      )}
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
      <div className="text-slate-900 dark:text-slate-100 mt-0.5">{children}</div>
    </div>
  );
}
