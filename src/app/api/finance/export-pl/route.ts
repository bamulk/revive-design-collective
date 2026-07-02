import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Profit & Loss CSV export — what the accountant wants at year-end.
 *
 * `GET /api/finance/export-pl?year=2026`
 *
 * Output columns:
 *   Month, Income, <one column per expense category>, Total Expenses, Net
 *
 * Income rows use payments collected (stages.paid_at by month). Each
 * stage rolls up its FULL invoice amount on its paid_at month — partial
 * payments aren't split because stages.paid_at is the "fully paid on"
 * date set by the stage_payments trigger.
 *
 * Expenses are grouped by category. Uncategorized rolls into "Other".
 * Admins only.
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

  const [{ data: paidStages }, { data: expenses }] = await Promise.all([
    supabase
      .from("stages")
      .select("amount, paid_at")
      .not("paid_at", "is", null)
      .gte("paid_at", `${yearStart}T00:00:00Z`)
      .lte("paid_at", `${yearEnd}T23:59:59Z`),
    supabase
      .from("expenses")
      .select("amount, category, date")
      .gte("date", yearStart)
      .lte("date", yearEnd),
  ]);

  // Discover the full set of categories present so the report covers
  // them all (avoids missing rows when a new category gets added).
  const categorySet = new Set<string>();
  for (const e of expenses ?? []) {
    categorySet.add(e.category || "Other");
  }
  const categories = Array.from(categorySet).sort();
  // Push "Other" to the end if present.
  const otherIdx = categories.indexOf("Other");
  if (otherIdx >= 0) {
    categories.splice(otherIdx, 1);
    categories.push("Other");
  }

  // Initialize 12 monthly buckets.
  type Bucket = {
    income: number;
    expensesByCategory: Map<string, number>;
  };
  const months: Bucket[] = Array.from({ length: 12 }, () => ({
    income: 0,
    expensesByCategory: new Map(categories.map((c) => [c, 0])),
  }));

  for (const r of paidStages ?? []) {
    const m = new Date(String(r.paid_at)).getUTCMonth(); // 0-11
    months[m].income += Number(r.amount ?? 0);
  }
  for (const e of expenses ?? []) {
    const m = Number(e.date.slice(5, 7)) - 1;
    if (m < 0 || m > 11) continue;
    const cat = e.category || "Other";
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

  const monthLabels = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const header = [
    "Month",
    "Income",
    ...categories,
    "Total Expenses",
    "Net",
  ];

  const rows: (string | number)[][] = [header];
  let totalIncome = 0;
  const totalByCategory = new Map<string, number>(
    categories.map((c) => [c, 0]),
  );
  for (let i = 0; i < 12; i++) {
    const b = months[i];
    const totalExpenses = categories.reduce(
      (sum, c) => sum + (b.expensesByCategory.get(c) ?? 0),
      0,
    );
    const net = b.income - totalExpenses;
    rows.push([
      `${monthLabels[i]} ${year}`,
      b.income.toFixed(2),
      ...categories.map((c) =>
        (b.expensesByCategory.get(c) ?? 0).toFixed(2),
      ),
      totalExpenses.toFixed(2),
      net.toFixed(2),
    ]);
    totalIncome += b.income;
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
  rows.push([
    `Total ${year}`,
    totalIncome.toFixed(2),
    ...categories.map((c) => (totalByCategory.get(c) ?? 0).toFixed(2)),
    grandExpenses.toFixed(2),
    (totalIncome - grandExpenses).toFixed(2),
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
