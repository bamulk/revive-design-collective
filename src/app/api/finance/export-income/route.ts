import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

/**
 * Income register CSV — every payment received in the tax year, one row
 * per transaction (cash basis). This is the transaction-level detail a
 * CPA reconciles against bank deposits and 1099-Ks; the P&L export is
 * the monthly rollup of the same data.
 *
 * `GET /api/finance/export-income?year=2026`
 *
 * Sources:
 *   - stage_payments (the payments ledger — actual receipt dates, so a
 *     December deposit and January balance land in different tax years)
 *   - stage_extensions with paid_at set (30-day extension fees)
 *
 * Columns: Date, Type, Client, Property, Method, Note, Amount.
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

  // Paged fetches — these can grow past PostgREST's 1000-row cap, and a
  // truncated register would silently understate income. id tiebreaker
  // keeps page boundaries stable. The extensions filter uses .lt(next
  // Jan 1) because stage_extensions.paid_at is a full timestamptz — an
  // .lte("…T23:59:59Z") bound would drop fractional-second timestamps.
  const [payments, extensions] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("stage_payments")
        .select(
          "amount, paid_at, method, note, stages(address, clients(name))",
        )
        .gte("paid_at", yearStart)
        .lte("paid_at", yearEnd)
        .order("paid_at", { ascending: true })
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("stage_extensions")
        .select("amount, paid_at, stages(address, clients(name))")
        .not("paid_at", "is", null)
        .gte("paid_at", yearStart)
        .lt("paid_at", `${year + 1}-01-01`)
        .order("paid_at", { ascending: true })
        .order("id")
        .range(from, to),
    ),
  ]);

  // Nested joins may come back as an object or a 1-element array
  // depending on the relationship metadata — normalize both.
  function stageInfo(row: any): { address: string; client: string } {
    const s = Array.isArray(row?.stages) ? row.stages[0] : row?.stages;
    const c = Array.isArray(s?.clients) ? s.clients[0] : s?.clients;
    return {
      address: s?.address ?? "",
      client: c?.name ?? "",
    };
  }

  type Entry = {
    date: string; // YYYY-MM-DD
    type: string;
    client: string;
    property: string;
    method: string;
    note: string;
    amount: number;
  };

  const entries: Entry[] = [];
  for (const p of payments ?? []) {
    const { address, client } = stageInfo(p);
    entries.push({
      date: String(p.paid_at).slice(0, 10),
      type: "Stage payment",
      client,
      property: address,
      method: p.method ?? "",
      note: p.note ?? "",
      amount: Number(p.amount ?? 0),
    });
  }
  for (const x of extensions ?? []) {
    const { address, client } = stageInfo(x);
    entries.push({
      date: String(x.paid_at).slice(0, 10),
      type: "Extension",
      client,
      property: address,
      method: "",
      note: "30-day stage extension",
      amount: Number(x.amount ?? 0),
    });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));

  function esc(v: string | number): string {
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  // Neutralize spreadsheet formula injection in free-text cells (names,
  // addresses, notes) — the file is opened in Excel by the CPA. Amount
  // stays raw so it sums.
  function neutralize(v: string): string {
    return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  }

  const rows: (string | number)[][] = [
    ["Date", "Type", "Client", "Property", "Method", "Note", "Amount"],
  ];
  let total = 0;
  for (const e of entries) {
    rows.push([
      e.date,
      e.type,
      neutralize(e.client),
      neutralize(e.property),
      neutralize(e.method),
      neutralize(e.note),
      e.amount.toFixed(2),
    ]);
    total += e.amount;
  }
  rows.push([]);
  rows.push([`Total ${year}`, "", "", "", "", "", total.toFixed(2)]);

  const csv = rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
  const filename = `revive-design-collective-income-${year}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
