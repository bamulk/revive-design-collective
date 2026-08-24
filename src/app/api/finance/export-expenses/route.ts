import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

/**
 * Expense register CSV — every expense in the tax year, one row per
 * transaction, followed by a per-category totals block. The detail lets
 * the CPA reclassify anything miscategorized; the totals block maps
 * straight onto the return's deduction lines.
 *
 * `GET /api/finance/export-expenses?year=2026`
 *
 * Columns: Date, Description, Category, Source, Amount.
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

  // Paged fetch — the year can exceed PostgREST's 1000-row cap (2026
  // already has 1200+ expense rows) and a truncated register would
  // silently understate deductions. Ordered by date with an id
  // tiebreaker so page boundaries are stable.
  const expenses = await fetchAllRows((from, to) =>
    supabase
      .from("expenses")
      .select("date, amount, description, category, source")
      .gte("date", yearStart)
      .lte("date", yearEnd)
      .order("date", { ascending: true })
      .order("id")
      .range(from, to),
  );

  const SOURCE_LABELS: Record<string, string> = {
    boa_csv: "Bank import (BoA)",
    plaid: "Bank sync (Plaid)",
    manual: "Manual entry",
  };

  function esc(v: string | number): string {
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  // Neutralize spreadsheet formula injection in free-text cells — a
  // bank-fed description starting with = + - @ would evaluate as a
  // formula when the CPA opens the file in Excel. Amount columns skip
  // this so they stay summable.
  function neutralize(v: string): string {
    return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  }

  const rows: (string | number)[][] = [
    ["Date", "Description", "Category", "Source", "Amount"],
  ];
  let total = 0;
  const byCategory = new Map<string, number>();
  for (const e of expenses ?? []) {
    const amount = Number(e.amount ?? 0);
    const cat = e.category || "Uncategorized";
    rows.push([
      e.date,
      neutralize(e.description),
      neutralize(cat),
      neutralize(SOURCE_LABELS[e.source ?? ""] ?? e.source ?? ""),
      amount.toFixed(2),
    ]);
    total += amount;
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + amount);
  }
  rows.push([]);
  rows.push([`Total ${year}`, "", "", "", total.toFixed(2)]);

  // Category totals block — the summary the CPA maps to deduction lines.
  rows.push([]);
  rows.push(["Category totals", "", "", "", ""]);
  const cats = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, sum] of cats) {
    rows.push([neutralize(cat), "", "", "", sum.toFixed(2)]);
  }

  const csv = rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
  const filename = `revive-design-collective-expenses-${year}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
