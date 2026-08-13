import Link from "next/link";
import { Upload } from "lucide-react";
import ExportPLButton from "@/components/ExportPLButton";
import Sparkline from "@/components/Sparkline";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, LinkButton } from "@/components/ui";
import DeleteExpenseButton from "@/components/DeleteExpenseButton";
import RecategorizeButton from "@/components/RecategorizeButton";
import { createExpenseAction } from "./actions";
import { requireAdmin } from "@/lib/require-admin";
import RecentIncomeList, {
  type RecentIncomeRow,
} from "@/components/RecentIncomeList";
import TaxPackageCard, {
  type TaxYearStats,
} from "@/components/TaxPackageCard";
import { fetchAllRows } from "@/lib/fetch-all";
import PlaidSection from "./_PlaidSection";

function categoryTone(
  category: string,
): { dot: string; bar: string; text: string } {
  switch (category) {
    case "Payroll":
      return {
        dot: "bg-violet-500",
        bar: "bg-violet-500",
        text: "text-violet-500",
      };
    case "Gas":
      return {
        dot: "bg-amber-500",
        bar: "bg-amber-500",
        text: "text-amber-500",
      };
    case "Inventory":
      return {
        dot: "bg-sky-500",
        bar: "bg-sky-500",
        text: "text-sky-500",
      };
    default:
      return {
        dot: "bg-slate-400",
        bar: "bg-slate-400",
        text: "text-slate-400",
      };
  }
}

export const dynamic = "force-dynamic";

type MonthBucket = {
  key: string; // YYYY-MM
  label: string; // "May '26"
  income: number;
  expense: number;
  /**
   * Expected (still-uncollected) revenue for work staged this month —
   * the billed amount of non-cancelled stages with stage_date in the
   * month that haven't been paid yet. Drawn as a grey cap on top of
   * the collected income bar.
   */
  expected: number;
  /**
   * Total billed amount of every stage staged this month, paid or not
   * (keyed by stage_date). Unlike `income` (keyed by payment date),
   * this stays tied to the month the work happened — used for
   * profit-per-stage so payment timing across a month boundary doesn't
   * distort the figure. Since all stages get paid, this is the eventual
   * revenue for the month's work.
   */
  billed: number;
  /** Count of stages whose stage_date falls in this month. */
  stages: number;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Builds a series of N months ending at the current month. */
function buildMonths(count: number): MonthBucket[] {
  const now = new Date();
  const result: MonthBucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    result.push({
      key,
      label: monthLabel(key),
      income: 0,
      expense: 0,
      expected: 0,
      billed: 0,
      stages: 0,
    });
  }
  return result;
}

export default async function FinancePage() {
  await requireAdmin();
  const supabase = await createClient();

  // Every query here feeds money totals, so ALL of them page through
  // PostgREST's 1000-row cap via fetchAllRows — expenses crossed 1000
  // rows in mid-2026 and an unbounded select silently truncated the
  // dashboard + exports. Each query orders by a unique key (id) so
  // pagination is stable.
  const [paidStages, expenses, stageDateRows, paidExtensions, allPayments] =
    await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("stages")
          .select(
            "id, address, amount, paid_at, payment_method, clients(name)",
          )
          .not("paid_at", "is", null)
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("expenses")
          .select("id, date, amount, description, source, category")
          .order("date", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      // For the stages-per-month line + expected-revenue cap: every
      // stage with a stage_date, skipping estimates + cancelled jobs.
      fetchAllRows((from, to) =>
        supabase
          .from("stages")
          .select("id, stage_date, amount, paid_at")
          .neq("status", "estimate")
          .neq("status", "cancelled")
          .not("stage_date", "is", null)
          .order("id")
          .range(from, to),
      ),
      // Paid 30-day extension fees — real revenue that used to be
      // invisible to this page (tracked only in stage_extensions).
      fetchAllRows((from, to) =>
        supabase
          .from("stage_extensions")
          .select("id, amount, paid_at")
          .not("paid_at", "is", null)
          .order("id")
          .range(from, to),
      ),
      // The payments ledger — the tax package's cash-basis income source
      // (each payment on the date it was actually received).
      fetchAllRows((from, to) =>
        supabase
          .from("stage_payments")
          .select("id, amount, paid_at")
          .order("id")
          .range(from, to),
      ),
    ]);

  // Recent income — last 30 paid stages, newest first. Used by the
  // RecentIncomeList component below the bar chart. Sorted client-side
  // because the totals math above doesn't care about order.
  const recentIncome: RecentIncomeRow[] = (paidStages ?? [])
    .filter((s: any) => !!s.paid_at)
    .sort((a: any, b: any) =>
      String(b.paid_at).localeCompare(String(a.paid_at)),
    )
    .slice(0, 30)
    .map((s: any) => ({
      id: s.id,
      address: s.address,
      amount: Number(s.amount ?? 0),
      paid_at: s.paid_at,
      payment_method: s.payment_method,
      client_name: s.clients?.name ?? null,
    }));

  // Last 12 months for the bar chart.
  const months = buildMonths(12);
  const monthMap = new Map(months.map((m) => [m.key, m]));

  for (const row of paidStages ?? []) {
    if (!row.paid_at) continue;
    const key = monthKey(String(row.paid_at));
    const bucket = monthMap.get(key);
    if (bucket) bucket.income += Number(row.amount ?? 0);
  }
  // Paid extension fees count as income in the month they were paid.
  for (const row of paidExtensions ?? []) {
    const key = monthKey(String(row.paid_at));
    const bucket = monthMap.get(key);
    if (bucket) bucket.income += Number(row.amount ?? 0);
  }
  for (const row of expenses ?? []) {
    const key = monthKey(row.date);
    const bucket = monthMap.get(key);
    if (bucket) bucket.expense += Number(row.amount ?? 0);
  }
  for (const row of stageDateRows ?? []) {
    if (!row.stage_date) continue;
    const key = monthKey(String(row.stage_date));
    const bucket = monthMap.get(key);
    if (!bucket) continue;
    bucket.stages += 1;
    // Every stage's billed amount counts toward the month it was
    // staged, regardless of when it's paid — this is the revenue basis
    // for profit-per-stage so payment timing doesn't distort it.
    bucket.billed += Number(row.amount ?? 0);
    // Unpaid billed work also counts toward expected revenue (the
    // cash-flow view: money still to collect for the month).
    if (!row.paid_at) {
      bucket.expected += Number(row.amount ?? 0);
    }
  }

  // YTD totals.
  const year = new Date().getFullYear();
  let ytdIncome = 0;
  let ytdExpense = 0;
  // Stage income WITHOUT extensions — the "Avg per paid stage" stat
  // divides by paid-stage count, so extension fees would inflate it.
  let ytdStageIncome = 0;
  for (const row of paidStages ?? []) {
    if (row.paid_at && String(row.paid_at).startsWith(`${year}-`)) {
      ytdIncome += Number(row.amount ?? 0);
      ytdStageIncome += Number(row.amount ?? 0);
    }
  }
  for (const row of paidExtensions ?? []) {
    if (String(row.paid_at).startsWith(`${year}-`)) {
      ytdIncome += Number(row.amount ?? 0);
    }
  }
  for (const row of expenses ?? []) {
    if (row.date.startsWith(`${year}-`)) {
      ytdExpense += Number(row.amount ?? 0);
    }
  }
  const ytdNet = ytdIncome - ytdExpense;
  // Outstanding receivables — billed-but-not-paid work, same data the
  // chart's grey "Expected (unpaid)" cap uses. Stage-date-driven so it
  // captures real billable work for the year regardless of when the
  // invoice was sent.
  const ytdOutstanding = months.reduce((sum, m) => sum + m.expected, 0);

  // --- Secondary stats -----------------------------------------------
  // Rolling 30-day window — a "what just happened" snapshot that's
  // more sensitive than YTD totals (which lag in January / lead in
  // December). Pure JS, no extra fetches.
  const todayIso = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  let last30Income = 0;
  let last30Expense = 0;
  let last30Stages = 0;
  let ytdPaidStageCount = 0;
  for (const row of paidStages ?? []) {
    if (!row.paid_at) continue;
    const d = String(row.paid_at).slice(0, 10);
    if (d >= thirtyDaysAgo && d <= todayIso) {
      last30Income += Number(row.amount ?? 0);
    }
    if (d.startsWith(`${year}-`)) {
      ytdPaidStageCount += 1;
    }
  }
  for (const row of paidExtensions ?? []) {
    const d = String(row.paid_at).slice(0, 10);
    if (d >= thirtyDaysAgo && d <= todayIso) {
      last30Income += Number(row.amount ?? 0);
    }
  }
  for (const row of expenses ?? []) {
    if (row.date >= thirtyDaysAgo && row.date <= todayIso) {
      last30Expense += Number(row.amount ?? 0);
    }
  }
  for (const row of stageDateRows ?? []) {
    if (!row.stage_date) continue;
    const d = String(row.stage_date).slice(0, 10);
    if (d >= thirtyDaysAgo && d <= todayIso) last30Stages += 1;
  }
  const last30Net = last30Income - last30Expense;
  const avgPerPaidStage =
    ytdPaidStageCount > 0 ? ytdStageIncome / ytdPaidStageCount : 0;

  // --- Quarterly summary for the current year ------------------------
  // Aggregate paidStages + expenses into 4 quarter buckets. Stages
  // count uses stage_date so it captures actual work done.
  const quarters = Array.from({ length: 4 }, () => ({
    income: 0,
    expense: 0,
    stages: 0,
  }));
  for (const row of paidStages ?? []) {
    if (!row.paid_at) continue;
    const ds = String(row.paid_at);
    if (!ds.startsWith(`${year}-`)) continue;
    const m = new Date(ds).getUTCMonth();
    quarters[Math.floor(m / 3)].income += Number(row.amount ?? 0);
  }
  for (const row of paidExtensions ?? []) {
    const ds = String(row.paid_at);
    if (!ds.startsWith(`${year}-`)) continue;
    const m = Number(ds.slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    quarters[Math.floor(m / 3)].income += Number(row.amount ?? 0);
  }
  for (const row of expenses ?? []) {
    if (!row.date.startsWith(`${year}-`)) continue;
    const m = Number(row.date.slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    quarters[Math.floor(m / 3)].expense += Number(row.amount ?? 0);
  }
  for (const row of stageDateRows ?? []) {
    if (!row.stage_date) continue;
    const ds = String(row.stage_date);
    if (!ds.startsWith(`${year}-`)) continue;
    const m = Number(ds.slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    quarters[Math.floor(m / 3)].stages += 1;
  }

  // --- Per-category monthly trend (last 12 months) -------------------
  // Map<category, number[12]> aligned to `months` so the sparkline x-
  // axis matches the bar chart above it visually.
  const categoryTrend = new Map<string, number[]>();
  for (const m of months) categoryTrend; // (lint hint — referenced below)
  function monthIndexFor(dateStr: string): number {
    const key = dateStr.slice(0, 7);
    return months.findIndex((mm) => mm.key === key);
  }
  for (const e of expenses ?? []) {
    const idx = monthIndexFor(e.date);
    if (idx < 0) continue;
    const cat = e.category || "Uncategorized";
    const arr = categoryTrend.get(cat) ?? new Array(months.length).fill(0);
    arr[idx] += Number(e.amount ?? 0);
    categoryTrend.set(cat, arr);
  }
  // Payroll-only monthly series (aligned to `months`) for the
  // "Net per stage after payroll" card.
  const payrollTrend: number[] =
    categoryTrend.get("Payroll") ?? new Array(months.length).fill(0);

  // --- Year picker for the P&L export --------------------------------
  // Render the current year + every year we have data for, descending.
  const yearSet = new Set<number>([year]);
  for (const r of paidStages ?? []) {
    const y = Number(String(r.paid_at ?? "").slice(0, 4));
    if (y >= 2020) yearSet.add(y);
  }
  for (const r of expenses ?? []) {
    const y = Number(r.date.slice(0, 4));
    if (y >= 2020) yearSet.add(y);
  }
  for (const r of allPayments ?? []) {
    const y = Number(String(r.paid_at ?? "").slice(0, 4));
    if (y >= 2020) yearSet.add(y);
  }
  for (const r of paidExtensions ?? []) {
    const y = Number(String(r.paid_at ?? "").slice(0, 4));
    if (y >= 2020) yearSet.add(y);
  }
  const exportYears = Array.from(yearSet).sort((a, b) => b - a);

  // --- Tax package: per-year cash-basis rollups -----------------------
  // Income here comes from the payments LEDGER (each payment on its
  // receipt date) + paid extension fees — the same sources the CSV
  // exports use, so the card's numbers match the files it hands out.
  const taxStats: Record<number, TaxYearStats> = {};
  const incomeByYearMonth = new Map<string, number>(); // "YYYY-MM" -> $
  const expenseByYearMonth = new Map<string, number>();
  function ensureYear(y: number): TaxYearStats {
    return (taxStats[y] ??= {
      stagingIncome: 0,
      extensionIncome: 0,
      expenses: 0,
      paymentCount: 0,
      expenseCount: 0,
      uncategorizedCount: 0,
      monthsWithIncomeNoExpenses: 0,
    });
  }
  for (const r of allPayments ?? []) {
    const ds = String(r.paid_at ?? "");
    const y = Number(ds.slice(0, 4));
    if (y < 2020) continue;
    const s = ensureYear(y);
    s.stagingIncome += Number(r.amount ?? 0);
    s.paymentCount += 1;
    const ym = ds.slice(0, 7);
    incomeByYearMonth.set(
      ym,
      (incomeByYearMonth.get(ym) ?? 0) + Number(r.amount ?? 0),
    );
  }
  for (const r of paidExtensions ?? []) {
    const ds = String(r.paid_at ?? "");
    const y = Number(ds.slice(0, 4));
    if (y < 2020) continue;
    const s = ensureYear(y);
    s.extensionIncome += Number(r.amount ?? 0);
    s.paymentCount += 1;
    const ym = ds.slice(0, 7);
    incomeByYearMonth.set(
      ym,
      (incomeByYearMonth.get(ym) ?? 0) + Number(r.amount ?? 0),
    );
  }
  for (const r of expenses ?? []) {
    const y = Number(r.date.slice(0, 4));
    if (y < 2020) continue;
    const s = ensureYear(y);
    s.expenses += Number(r.amount ?? 0);
    s.expenseCount += 1;
    if (!r.category) s.uncategorizedCount += 1;
    const ym = r.date.slice(0, 7);
    expenseByYearMonth.set(
      ym,
      (expenseByYearMonth.get(ym) ?? 0) + Number(r.amount ?? 0),
    );
  }
  // Months where money came in but nothing was spent (per the records)
  // — almost always a sign the bank import is behind, not reality.
  for (const [ym, income] of incomeByYearMonth) {
    if (income <= 0) continue;
    if ((expenseByYearMonth.get(ym) ?? 0) > 0) continue;
    const y = Number(ym.slice(0, 4));
    if (taxStats[y]) taxStats[y].monthsWithIncomeNoExpenses += 1;
  }

  // YTD category breakdown for the expense pie/legend.
  const ytdByCategory = new Map<string, number>();
  for (const row of expenses ?? []) {
    if (!row.date.startsWith(`${year}-`)) continue;
    const cat = row.category || "Uncategorized";
    ytdByCategory.set(cat, (ytdByCategory.get(cat) ?? 0) + Number(row.amount));
  }
  const categoryTotals = [...ytdByCategory.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);

  // Peak accounts for the stacked income + expected bar so the grey
  // cap never overflows the chart.
  const peak = Math.max(
    ...months.map((m) => Math.max(m.income + m.expected, m.expense)),
    1
  );
  // Independent peak for the stages-per-month line so the line uses
  // the full chart height instead of being squashed by the dollar
  // scale (a typical month is ~$10k income vs ~10 stages).
  const stagesPeak = Math.max(...months.map((m) => m.stages), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        subtitle={`Year-to-date · in ${fmtMoney(ytdIncome)} · out ${fmtMoney(
          ytdExpense
        )} · net ${fmtMoney(ytdNet)}`}
        actions={
          <>
            <ExportPLButton years={exportYears} defaultYear={year} />
            <LinkButton href="/finance/import" variant="secondary">
              <Upload size={14} /> Import BoA CSV
            </LinkButton>
          </>
        }
      />

      {/* KPI tiles — at-a-glance money picture. Receivables = billed-
          but-not-paid work (sum of monthly expected). Margin is shown
          as a sub-line under Net so it sits with the bottom-line
          number it qualifies. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="YTD income" value={ytdIncome} tone="emerald" />
        <KpiTile label="YTD expenses" value={ytdExpense} tone="rose" />
        <KpiTile
          label="YTD net"
          value={ytdNet}
          tone={ytdNet >= 0 ? "emerald" : "rose"}
          subline={
            ytdIncome > 0
              ? `${((ytdNet / ytdIncome) * 100).toFixed(1)}% margin`
              : undefined
          }
        />
        <KpiTile
          label="Outstanding"
          value={ytdOutstanding}
          tone="amber"
          subline="Billed, not yet paid"
        />
      </div>

      {/* Quick-glance bar: last 30 days + average per stage. Compact
          single card so it doesn't compete with the primary KPIs. */}
      <Card className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
        <Stat
          label="Last 30 days in"
          value={fmtMoney(last30Income)}
          tone="text-emerald-700 dark:text-emerald-300"
        />
        <Stat
          label="Last 30 days out"
          value={fmtMoney(last30Expense)}
          tone="text-rose-700 dark:text-rose-300"
        />
        <Stat
          label="Last 30 days net"
          value={fmtMoney(last30Net)}
          tone={
            last30Net >= 0
              ? "text-slate-900 dark:text-slate-100"
              : "text-rose-700 dark:text-rose-300"
          }
          subline={`${last30Stages} stage${last30Stages === 1 ? "" : "s"}`}
        />
        <Stat
          label="Avg per paid stage"
          value={fmtMoney(avgPerPaidStage)}
          tone="text-slate-900 dark:text-slate-100"
          subline={`${ytdPaidStageCount} paid YTD`}
        />
      </Card>

      {/* Quarterly summary for the current year */}
      <Card className="p-5 space-y-3">
        <h2 className="text-base font-semibold tracking-tight">
          {year} by quarter
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {quarters.map((q, i) => {
            const net = q.income - q.expense;
            const label = `Q${i + 1}`;
            return (
              <div
                key={i}
                className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {label} {year}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {q.stages} stg
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-sm tabular-nums">
                  <span className="text-emerald-700 dark:text-emerald-300">
                    {fmtMoney(q.income)}
                  </span>
                  <span className="text-rose-700 dark:text-rose-300 text-right">
                    {fmtMoney(q.expense)}
                  </span>
                </div>
                <div
                  className={`text-sm font-semibold tabular-nums pt-0.5 border-t border-slate-100 dark:border-slate-800 ${
                    net >= 0
                      ? "text-slate-900 dark:text-slate-100"
                      : "text-rose-700 dark:text-rose-300"
                  }`}
                >
                  Net {fmtMoney(net)}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Tax package — everything the CPA needs for a filing year. */}
      <TaxPackageCard
        years={exportYears}
        defaultYear={year}
        stats={taxStats}
      />

      {/* YTD expenses by category */}
      {categoryTotals.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-base font-semibold tracking-tight">
              YTD expenses by category
            </h2>
            <RecategorizeButton />
          </div>
          <ul className="space-y-2">
            {categoryTotals.map(({ category, total }) => {
              const pct = ytdExpense > 0 ? (total / ytdExpense) * 100 : 0;
              const tone = categoryTone(category);
              const trend = categoryTrend.get(category) ?? [];
              return (
                <li key={category} className="space-y-1">
                  <div className="flex items-center justify-between text-sm gap-3">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <span className={`w-2.5 h-2.5 rounded-sm ${tone.dot}`} />
                      <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {category}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-3 shrink-0">
                      {/* 12-month trend sparkline tinted to match the
                          category color. Hidden on extra-narrow phones
                          so it doesn't squeeze the amount. */}
                      <span
                        className={`hidden sm:inline-flex items-end leading-none ${tone.text}`}
                        title={`${category} — last 12 months`}
                      >
                        <Sparkline
                          values={trend}
                          width={88}
                          height={22}
                          title={`${category} last 12 months`}
                        />
                      </span>
                      <span className="text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                        {fmtMoney(total)}{" "}
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          ({pct.toFixed(1)}%)
                        </span>
                      </span>
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
                    <div
                      className={`h-full ${tone.bar}`}
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Bar chart */}
      <Card className="p-5 space-y-3">
        <h2 className="text-base font-semibold tracking-tight">
          Last 12 months
        </h2>
        <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Collected
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-300 dark:bg-slate-600" />
            Expected (unpaid)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> Expense
          </span>
        </div>

        <div className="overflow-x-auto">
          {/* Fixed-pixel plotting area so bar heights don't depend on
              a fragile percentage-height chain through nested flex
              containers. PLOT_PX is the max bar height in px. */}
          <div className="flex gap-3 sm:gap-4 min-w-[600px]">
            {months.map((m) => {
              const PLOT_PX = 200;
              const inPx = Math.round((m.income / peak) * PLOT_PX);
              const expPx = Math.round((m.expected / peak) * PLOT_PX);
              const exPx = Math.round((m.expense / peak) * PLOT_PX);
              return (
                <div
                  key={m.key}
                  className="flex-1 flex flex-col items-center min-w-0"
                >
                  <div
                    className="w-full flex items-end justify-center gap-1"
                    style={{ height: PLOT_PX }}
                  >
                    {/* Income column: collected (emerald) + still-
                        expected (grey) stacked on top. */}
                    <div className="w-1/2 flex flex-col justify-end">
                      {m.expected > 0 && (
                        <div
                          title={`Expected (unpaid) ${fmtMoney(m.expected)}`}
                          className="bg-slate-300 dark:bg-slate-600 rounded-t-sm"
                          style={{ height: Math.max(expPx, 2) }}
                        />
                      )}
                      <div
                        title={`Collected ${fmtMoney(m.income)}`}
                        className={`bg-emerald-500 ${
                          m.expected > 0 ? "" : "rounded-t-sm"
                        }`}
                        style={{ height: m.income > 0 ? Math.max(inPx, 2) : 0 }}
                      />
                    </div>
                    <div
                      title={`Expense ${fmtMoney(m.expense)}`}
                      className="w-1/2 bg-rose-500 rounded-t-sm"
                      style={{ height: m.expense > 0 ? Math.max(exPx, 2) : 0 }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate shrink-0">
                    {m.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Per-month breakdown. On phones the 6-column table crushes,
            so we render a stacked card per month there and switch to
            the full table at sm and up. */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          {/* Mobile: stacked cards */}
          <div className="space-y-2 sm:hidden">
            {[...months].reverse().map((m) => {
              const net = m.billed - m.expense;
              // Profit per stage: total money in for the month —
              // collected + still-expected (unpaid billed) — minus the
              // month's expenses, spread across the stages staged that
              // month. Null when there were no stages (can't divide).
              const profitPerStage =
                m.stages > 0 ? (m.billed - m.expense) / m.stages : null;
              return (
                <div
                  key={m.key}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {m.label}
                    </span>
                    <span className="text-xs tabular-nums text-indigo-700 dark:text-indigo-300">
                      {m.stages} stage{m.stages === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                    <MobileStat label="Billed" tone="text-emerald-700">
                      {fmtMoney(m.billed)}
                    </MobileStat>
                    <MobileStat
                      label="Expected"
                      tone="text-slate-500 dark:text-slate-400"
                    >
                      {m.expected > 0 ? fmtMoney(m.expected) : "—"}
                    </MobileStat>
                    <MobileStat label="Expense" tone="text-rose-700">
                      {fmtMoney(m.expense)}
                    </MobileStat>
                    <MobileStat
                      label="Net"
                      tone={
                        net >= 0
                          ? "text-slate-900 dark:text-slate-100"
                          : "text-rose-700"
                      }
                    >
                      {fmtMoney(net)}
                    </MobileStat>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
                    <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Profit / stage
                    </span>
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        profitPerStage == null
                          ? "text-slate-400 dark:text-slate-500"
                          : profitPerStage >= 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-rose-700"
                      }`}
                    >
                      {profitPerStage == null ? "—" : fmtMoney(profitPerStage)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* sm and up: full table */}
          <table className="hidden sm:table w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400 text-left">
                <th className="py-2 font-medium">Month</th>
                <th className="py-2 font-medium text-right">Stages</th>
                <th
                  className="py-2 font-medium text-right"
                  title="Billed revenue for stages staged this month (paid or not)"
                >
                  Billed
                </th>
                <th className="py-2 font-medium text-right">Expected</th>
                <th className="py-2 font-medium text-right">Expense</th>
                <th className="py-2 font-medium text-right">Net</th>
                <th
                  className="py-2 font-medium text-right"
                  title="(Billed revenue for stages staged this month − this month's expenses) ÷ stages this month"
                >
                  Profit / stage
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Table reads top-down with newest first; the bar chart
                  above stays oldest-on-the-left so the time series
                  scans naturally. */}
              {[...months].reverse().map((m) => {
                const net = m.billed - m.expense;
                const profitPerStage =
                  m.stages > 0 ? (m.billed - m.expense) / m.stages : null;
                return (
                  <tr key={m.key} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 font-medium">{m.label}</td>
                    <td className="py-2 text-right tabular-nums text-indigo-700 dark:text-indigo-300">
                      {m.stages}
                    </td>
                    <td className="py-2 text-right tabular-nums text-emerald-700">
                      {fmtMoney(m.billed)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {m.expected > 0 ? fmtMoney(m.expected) : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums text-rose-700">
                      {fmtMoney(m.expense)}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums font-medium ${
                        net >= 0 ? "text-slate-900 dark:text-slate-100" : "text-rose-700"
                      }`}
                    >
                      {fmtMoney(net)}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums font-semibold ${
                        profitPerStage == null
                          ? "text-slate-400 dark:text-slate-500"
                          : profitPerStage >= 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-rose-700"
                      }`}
                    >
                      {profitPerStage == null ? "—" : fmtMoney(profitPerStage)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Net per stage after payroll — what each stage clears once the
          crew is paid, month by month. Same revenue basis as the
          monthly table above (billed by the month staged, paid or not)
          but subtracting ONLY Payroll expenses instead of all spend. */}
      <Card className="p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="text-base font-semibold tracking-tight">
            Net per stage after payroll
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            (Stage income − payroll) ÷ stages, by month staged
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400 text-left">
                <th className="py-2 font-medium">Month</th>
                <th className="py-2 font-medium text-right">Stages</th>
                <th
                  className="py-2 font-medium text-right"
                  title="Billed revenue for stages staged this month (paid or not)"
                >
                  Stage income
                </th>
                <th className="py-2 font-medium text-right">Payroll</th>
                <th
                  className="py-2 font-medium text-right"
                  title="(Stage income − payroll) ÷ stages this month"
                >
                  Net / stage
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Newest first, matching the monthly table above. */}
              {months
                .map((m, idx) => ({ m, payroll: payrollTrend[idx] ?? 0 }))
                .reverse()
                .map(({ m, payroll }) => {
                  const netPerStage =
                    m.stages > 0 ? (m.billed - payroll) / m.stages : null;
                  return (
                    <tr
                      key={m.key}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="py-2 font-medium">{m.label}</td>
                      <td className="py-2 text-right tabular-nums text-indigo-700 dark:text-indigo-300">
                        {m.stages}
                      </td>
                      <td className="py-2 text-right tabular-nums text-emerald-700">
                        {fmtMoney(m.billed)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-rose-700">
                        {payroll > 0 ? fmtMoney(payroll) : "—"}
                      </td>
                      <td
                        className={`py-2 text-right tabular-nums font-semibold ${
                          netPerStage == null
                            ? "text-slate-400 dark:text-slate-500"
                            : netPerStage >= 0
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-rose-700"
                        }`}
                      >
                        {netPerStage == null ? "—" : fmtMoney(netPerStage)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Stages-per-month bar chart — its own card with its own count
          scale (independent of the dollar bars above). */}
      <Card className="p-5 space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="text-base font-semibold tracking-tight">
            Stages per month
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Peak{" "}
            <span className="font-medium text-slate-700 dark:text-slate-200 tabular-nums">
              {Math.max(...months.map((m) => m.stages))}
            </span>{" "}
            in the busiest month
          </span>
        </div>

        <div className="overflow-x-auto">
          <div className="flex gap-3 sm:gap-4 min-w-[600px]">
            {months.map((m) => {
              const STAGES_PLOT_PX = 140;
              const hPx = Math.round((m.stages / stagesPeak) * STAGES_PLOT_PX);
              return (
                <div
                  key={m.key}
                  className="flex-1 flex flex-col items-center min-w-0"
                >
                  <div
                    className="w-full flex items-end justify-center"
                    style={{ height: STAGES_PLOT_PX }}
                  >
                    <div
                      title={`${m.label}: ${m.stages} stage${
                        m.stages === 1 ? "" : "s"
                      }`}
                      className="w-3/5 bg-indigo-500 rounded-t-sm relative"
                      style={{ height: m.stages > 0 ? Math.max(hPx, 2) : 0 }}
                    >
                      {m.stages > 0 && (
                        <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] tabular-nums text-slate-600 dark:text-slate-400">
                          {m.stages}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate shrink-0">
                    {m.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Plaid: connect bank + list connected institutions */}
      <PlaidSection />

      {/* Manual expense entry */}
      <Card className="p-5 space-y-3">
        <h2 className="text-base font-semibold tracking-tight">
          Add an expense
        </h2>
        <form
          data-no-loader
          action={createExpenseAction}
          className="grid grid-cols-1 sm:grid-cols-12 gap-2"
        >
          <input
            name="date"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="sm:col-span-3 border rounded px-3 py-2 text-sm"
          />
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="Amount"
            className="sm:col-span-2 border rounded px-3 py-2 text-sm"
          />
          <input
            name="description"
            required
            placeholder="Description (e.g. furniture, gas)"
            className="sm:col-span-4 border rounded px-3 py-2 text-sm"
          />
          <input
            name="category"
            placeholder="Category (optional)"
            className="sm:col-span-2 border rounded px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="sm:col-span-1 bg-slate-900 text-white rounded px-3 py-2 text-sm hover:bg-slate-800"
          >
            Add
          </button>
        </form>
      </Card>

      {/* Recent income — last 30 paid stages, newest first */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">
          Recent income
        </h2>
        {recentIncome.length === 0 ? (
          <Card className="p-6 text-sm text-slate-500 dark:text-slate-400 text-center">
            No paid stages yet. Once you mark an invoice paid it&apos;ll
            land here.
          </Card>
        ) : (
          <RecentIncomeList rows={recentIncome} />
        )}
      </section>

      {/* Recent expenses */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">
          Recent expenses
        </h2>
        {(expenses?.length ?? 0) === 0 ? (
          <Card className="p-6 text-sm text-slate-500 dark:text-slate-400 text-center">
            No expenses yet — add one above or{" "}
            <Link
              href="/finance/import"
              className="text-brand underline"
            >
              import a BoA CSV
            </Link>
            .
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/80 text-left border-b border-slate-200 dark:border-slate-700/70">
                  <tr className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">
                    <th className="p-3 font-medium">Date</th>
                    <th className="p-3 font-medium">Description</th>
                    <th className="p-3 font-medium">Category</th>
                    <th className="p-3 font-medium">Source</th>
                    <th className="p-3 font-medium text-right">Amount</th>
                    <th className="p-3 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {(expenses ?? []).slice(0, 100).map((e) => (
                    <tr
                      key={e.id}
                      className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/60"
                    >
                      <td className="p-3 text-slate-700 dark:text-slate-300">{e.date}</td>
                      <td className="p-3 text-slate-900 dark:text-slate-100 truncate max-w-xs">
                        {e.description}
                      </td>
                      <td className="p-3 text-slate-700 dark:text-slate-300">
                        {e.category ?? "—"}
                      </td>
                      <td className="p-3 text-slate-500 dark:text-slate-400 text-xs">
                        {e.source ?? "manual"}
                      </td>
                      <td className="p-3 text-right text-rose-700 tabular-nums font-medium">
                        -{fmtMoney(Number(e.amount))}
                      </td>
                      <td className="p-3 text-right">
                        <DeleteExpenseButton id={e.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

/** Labeled stat cell for the mobile per-month cards. */
function MobileStat({
  label,
  tone,
  children,
}: {
  label: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className={`tabular-nums font-medium ${tone}`}>{children}</span>
    </div>
  );
}

/** Compact labeled stat used by the Last-30-days quick-glance bar. */
function Stat({
  label,
  value,
  tone,
  subline,
}: {
  label: string;
  value: string;
  tone: string;
  subline?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className={`text-lg font-semibold tabular-nums ${tone}`}>
        {value}
      </div>
      {subline && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
          {subline}
        </div>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  tone,
  subline,
}: {
  label: string;
  value: number;
  tone: "emerald" | "rose" | "amber";
  /** Optional small caption under the dollar number — used for the
   *  margin % under Net and the "Billed, not yet paid" hint under
   *  Outstanding. */
  subline?: string;
}) {
  const bg =
    tone === "emerald"
      ? "from-emerald-500 to-teal-600"
      : tone === "amber"
        ? "from-amber-400 to-amber-600"
        : "from-rose-500 to-rose-700";
  return (
    <div className="relative overflow-hidden rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm p-5">
      <div
        className={`absolute -top-8 -right-8 w-28 h-28 rounded-full bg-gradient-to-br ${bg} opacity-15 blur-xl`}
      />
      <div className="relative">
        <div className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">
          {label}
        </div>
        <div className="text-2xl sm:text-3xl font-semibold mt-1 tracking-tight tabular-nums">
          {fmtMoney(value)}
        </div>
        {subline && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {subline}
          </div>
        )}
      </div>
    </div>
  );
}
