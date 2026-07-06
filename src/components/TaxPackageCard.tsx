"use client";

import { useState } from "react";
import { Download, FileText, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui";

/** Per-tax-year rollup computed server-side on the finance page. */
export type TaxYearStats = {
  /** Staging payments received in the year (payments ledger, cash basis). */
  stagingIncome: number;
  /** Paid 30-day extension fees received in the year. */
  extensionIncome: number;
  /** Total expenses recorded for the year. */
  expenses: number;
  /** Number of payment transactions (staging + extension). */
  paymentCount: number;
  /** Number of expense rows. */
  expenseCount: number;
  /** Expense rows with no category. */
  uncategorizedCount: number;
  /** Months with income received but zero expenses recorded. */
  monthsWithIncomeNoExpenses: number;
};

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * "Tax package" card on the Finance page — one place to grab everything
 * the CPA needs for a filing year: the monthly P&L summary, the income
 * register (every payment received), and the expense register (every
 * expense + category totals). All three are cash-basis and share the
 * same year, so they reconcile against each other.
 *
 * Also surfaces data-completeness warnings (missing expense months,
 * uncategorized expenses) so gaps get fixed BEFORE the files go out.
 */
export default function TaxPackageCard({
  years,
  defaultYear,
  stats,
}: {
  years: number[];
  defaultYear: number;
  stats: Record<number, TaxYearStats>;
}) {
  const [year, setYear] = useState(defaultYear);
  const s = stats[year];
  const gross = (s?.stagingIncome ?? 0) + (s?.extensionIncome ?? 0);
  const net = gross - (s?.expenses ?? 0);

  const files = [
    {
      href: `/api/finance/export-pl?year=${year}`,
      label: "P&L summary",
      detail: "Month-by-month income and expenses by category",
    },
    {
      href: `/api/finance/export-income?year=${year}`,
      label: "Income register",
      detail: "Every payment received — date, client, property, method",
    },
    {
      href: `/api/finance/export-expenses?year=${year}`,
      label: "Expense register",
      detail: "Every expense with category, plus category totals",
    },
  ];

  const warnings: string[] = [];
  if (s && s.monthsWithIncomeNoExpenses > 0) {
    warnings.push(
      `${s.monthsWithIncomeNoExpenses} month${
        s.monthsWithIncomeNoExpenses === 1 ? " has" : "s have"
      } income but no recorded expenses — import bank CSVs (or connect Plaid) so deductions aren't missing for ${year}.`,
    );
  }
  if (s && s.uncategorizedCount > 0) {
    warnings.push(
      `${s.uncategorizedCount} expense${
        s.uncategorizedCount === 1 ? " is" : "s are"
      } uncategorized — tap "Recategorize all" or fix them before sending.`,
    );
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Tax package for your CPA
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Cash basis — income counts when the payment was received,
            expenses when paid. The three files reconcile with each other.
          </p>
        </div>
        <label className="text-sm inline-flex items-center gap-2">
          <span className="text-slate-600 dark:text-slate-400">Tax year</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="border border-slate-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-slate-900"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Year summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-800/40 p-3">
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Gross receipts
          </div>
          <div className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
            {fmtMoney(gross)}
          </div>
          {(s?.extensionIncome ?? 0) > 0 && (
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              incl. {fmtMoney(s!.extensionIncome)} extensions
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Expenses
          </div>
          <div className="font-semibold tabular-nums text-rose-700 dark:text-rose-300">
            {fmtMoney(s?.expenses ?? 0)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Net</div>
          <div
            className={`font-semibold tabular-nums ${
              net >= 0
                ? "text-slate-900 dark:text-slate-100"
                : "text-rose-700 dark:text-rose-300"
            }`}
          >
            {fmtMoney(net)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Records
          </div>
          <div className="font-medium tabular-nums text-slate-700 dark:text-slate-300">
            {s?.paymentCount ?? 0} payments · {s?.expenseCount ?? 0} expenses
          </div>
        </div>
      </div>

      {/* Download buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {files.map((f) => (
          <a
            key={f.label}
            href={f.href}
            // `download` keeps the global RouteLoader overlay from
            // firing — it exempts download links, and a CSV response
            // never changes the pathname so the overlay would hang.
            download
            className="group flex items-start gap-2.5 rounded-lg border border-slate-200 dark:border-slate-700 p-3 hover:border-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition"
          >
            <span className="mt-0.5 inline-flex items-center justify-center w-7 h-7 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-slate-100 shrink-0">
              <FileText size={14} />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {f.label}
                <Download size={12} className="text-slate-400" />
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                {f.detail}
              </span>
            </span>
          </a>
        ))}
      </div>

      {/* Data-completeness warnings */}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 p-3 space-y-1.5">
          {warnings.map((w, i) => (
            <p
              key={i}
              className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200"
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}
