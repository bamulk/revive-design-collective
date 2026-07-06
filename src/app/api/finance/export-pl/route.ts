import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

/**
 * Profit & Loss CSV export — what the accountant wants at year-end.
 *
 * `GET /api/finance/export-pl?year=2026`
 *
 * Output columns:
 *   Month, Staging income, Extension income, Total income,
 *   <one column per expense category>, Total Expenses, Net
 *
 * Income is CASH BASIS from the payments ledger (stage_payments), so
 * each payment counts in the month it was actually received — a partial
 * payment in December and the balance in January land in different tax
 * years. Paid 30-day extension fees are a separate income column.
 *
 * Expenses are grouped by category; NULL categories show as
 * "Uncategorized" (matching the expense-register export). Admins only.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const yearParam = Number(req.nextUrl.searchParams.get("year") ?? "");
  const year =
    Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 9999
      ? yearParam
      : new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  // Paged fetches — expenses already exceed PostgREST's 1000-row cap
  // for 2026, and an unbounded select silently truncates (wrong Total
  // Expenses / Net on a tax document). id-ordered so pages are stable.
  // Extensions filter with .lt(next Jan 1): paid_at is timestamptz, so
  // an .lte("…T23:59:59Z") bound drops fractional-second timestamps.
  const [payments, extensions, expenses] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("stage_payments")
        .select("amount, paid_at")
        .gte("paid_at", yearStart)
        .lte("paid_at", yearEnd)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("stage_extensions")
        .select("amount, paid_at")
        .not("paid_at", "is", null)
        .gte("paid_at", yearStart)
        .lt("paid_at", `${year + 1}-01-01`)
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("expenses")
        .select("amount, category, date")
        .gte("date", yearStart)
        .lte("date", yearEnd)
        .order("id")
        .range(from, to),
    ),
  ]);

  // Discover the full set of categories present so the report covers
  // them all (avoids missing rows when a new category gets added).
  // NULL categories become "Uncategorized" — same label the expense
  // register uses, so the two files' category blocks reconcile.
  const categorySet = new Set<string>();
  for (const e of expenses ?? []) {
    categorySet.add(e.category || "Uncategorized");
  }
  const categories = Array.from(categorySet).sort();
  // Push "Uncategorized" to the end if present.
  const uncatIdx = categories.indexOf("Uncategorized");
  if (uncatIdx >= 0) {
    categories.splice(uncatIdx, 1);
    categories.push("Uncategorized");
  }

  // Initialize 12 monthly buckets.
  type Bucket = {
    income: number; // staging payments received
    extIncome: number; // paid extension fees
    expensesByCategory: Map<string, number>;
  };
  const months: Bucket[] = Array.from({ length: 12 }, () => ({
    income: 0,
    extIncome: 0,
    expensesByCategory: new Map(categories.map((c) => [c, 0])),
  }));

  // stage_payments.paid_at is a plain date — slice the month straight
  // out of the string so no timezone math can shift it.
  for (const r of payments ?? []) {
    const m = Number(String(r.paid_at).slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    months[m].income += Number(r.amount ?? 0);
  }
  for (const r of extensions ?? []) {
    const m = Number(String(r.paid_at).slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    months[m].extIncome += Number(r.amount ?? 0);
  }
  for (const e of expenses ?? []) {
    const m = Number(e.date.slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    const cat = e.category || "Uncategorized";
    const bucket = months[m].expensesByCategory;
    bucket.set(cat, (bucket.get(cat) ?? 0) + Number(e.amount ?? 0));
  }

  // CSV escape — wrap in quotes when the cell has a comma / quote /
  // newline; double any internal quotes per RFC 4180.
  function esc(v: string | number): string {
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  // Neutralize spreadsheet formula injection — category names are the
  // only user-influenced text here (the manual expense form accepts
  // arbitrary categories) and they appear as column headers in Excel.
  function neutralize(v: string): string {
    return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  }

  const monthLabels = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const header = [
    "Month",
    "Staging income",
    "Extension income",
    "Total income",
    ...categories.map(neutralize),
    "Total Expenses",
    "Net",
  ];

  const rows: (string | number)[][] = [header];
  let totalIncome = 0;
  let totalExtIncome = 0;
  const totalByCategory = new Map<string, number>(
    categories.map((c) => [c, 0]),
  );
  for (let i = 0; i < 12; i++) {
    const b = months[i];
    const totalExpenses = categories.reduce(
      (sum, c) => sum + (b.expensesByCategory.get(c) ?? 0),
      0,
    );
    const monthIncome = b.income + b.extIncome;
    const net = monthIncome - totalExpenses;
    rows.push([
      `${monthLabels[i]} ${year}`,
      b.income.toFixed(2),
      b.extIncome.toFixed(2),
      monthIncome.toFixed(2),
      ...categories.map((c) =>
        (b.expensesByCategory.get(c) ?? 0).toFixed(2),
      ),
      totalExpenses.toFixed(2),
      net.toFixed(2),
    ]);
    totalIncome += b.income;
    totalExtIncome += b.extIncome;
    for (const c of categories) {
      totalByCategory.set(
        c,
        (totalByCategory.get(c) ?? 0) +
          (b.expensesByCategory.get(c) ?? 0),
      );
    }
  }
  const grandExpenses = categories.reduce(
    (sum, c) => sum + (totalByCategory.get(c) ?? 0),
    0,
  );
  const grandIncome = totalIncome + totalExtIncome;
  rows.push([
    `Total ${year}`,
    totalIncome.toFixed(2),
    totalExtIncome.toFixed(2),
    grandIncome.toFixed(2),
    ...categories.map((c) => (totalByCategory.get(c) ?? 0).toFixed(2)),
    grandExpenses.toFixed(2),
    (grandIncome - grandExpenses).toFixed(2),
  ]);

  const csv = rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
  const filename = `revive-design-collective-pl-${year}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
