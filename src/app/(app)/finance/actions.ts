"use server";

import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import { parseBankOfAmericaCsv } from "@/lib/boa-csv";
import { categorizeExpense } from "@/lib/expense-categorize";

/** Stable hash for rows that don't carry a Reference Number from BoA. */
function syntheticExternalId(
  date: string,
  amount: number,
  description: string
): string {
  const key = `${date}|${amount.toFixed(2)}|${description.toLowerCase().replace(/\s+/g, " ").trim()}`;
  return "boa:" + createHash("sha1").update(key).digest("hex").slice(0, 16);
}

export type ImportResult =
  | {
      ok: true;
      inserted: number;
      duplicates: number;
      creditsSkipped: number;
      unparseableSkipped: number;
    }
  | { ok: false; error: string };

/**
 * Parses a Bank of America CSV string, dedupes on external_id, and
 * inserts new expenses. Returns counts so the UI can show "Imported N,
 * skipped M (already on file)" etc.
 */
export async function importBoaCsvAction(
  csv: string
): Promise<ImportResult> {
  try {
    if (!csv || csv.length < 10) throw new Error("Paste the BoA CSV first");
    const supabase = await createClient();
    const parsed = parseBankOfAmericaCsv(csv);

    if (parsed.rows.length === 0) {
      return {
        ok: true,
        inserted: 0,
        duplicates: 0,
        creditsSkipped: parsed.skipped.credits,
        unparseableSkipped: parsed.skipped.unparseable,
      };
    }

    // Pull existing external_ids so we can report duplicates accurately.
    // A big paste (a year of activity) can match over 1000 rows, so page.
    const ids = parsed.rows
      .map((r) => r.externalId)
      .filter((x): x is string => !!x);
    let existing = new Set<string>();
    if (ids.length > 0) {
      const existingRows = await fetchAllRows((from, to) =>
        supabase
          .from("expenses")
          .select("external_id")
          .in("external_id", ids)
          .order("external_id")
          .range(from, to),
      );
      existing = new Set(
        (existingRows ?? []).map((r) => r.external_id as string)
      );
    }

    const payload = parsed.rows.map((r) => ({
      date: r.date,
      amount: r.amount,
      description: r.description,
      // Auto-tag by vendor rules so the dashboard breakdown works
      // without manual review. See lib/expense-categorize.ts.
      category: categorizeExpense(r.description),
      source: "boa_csv",
      // Fall back to a stable synthetic id when BoA didn't give us a
      // Reference Number — that way re-pasting the same activity is a
      // no-op instead of duplicating every row.
      external_id:
        r.externalId ?? syntheticExternalId(r.date, r.amount, r.description),
    }));

    // Use upsert on external_id (when present) so re-imports don't dupe.
    // Count server-side instead of measuring the returned rows — the
    // representation is subject to the same 1000-row cap as selects, so
    // a big paste would under-report inserts.
    const { count: insertedCount, error } = await supabase
      .from("expenses")
      .upsert(payload, {
        onConflict: "external_id",
        ignoreDuplicates: true,
        count: "exact",
      });
    if (error) throw new Error(error.message);

    const inserted = insertedCount ?? 0;
    const duplicates = parsed.rows.length - inserted;
    revalidatePath("/finance");
    return {
      ok: true,
      inserted,
      duplicates: Math.max(0, duplicates),
      creditsSkipped: parsed.skipped.credits,
      unparseableSkipped: parsed.skipped.unparseable,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Import failed" };
  }
}

export type DeleteResult = { ok: true } | { ok: false; error: string };

export async function deleteExpenseAction(id: string): Promise<DeleteResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/finance");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Delete failed" };
  }
}

export async function createExpenseAction(formData: FormData) {
  const supabase = await createClient();
  const date = String(formData.get("date") || "").trim();
  const amountRaw = String(formData.get("amount") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const category = String(formData.get("category") || "").trim() || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a valid date");
  const amount = Math.abs(Number(amountRaw));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be a positive number");
  }
  if (!description) throw new Error("Description is required");

  const { error } = await supabase.from("expenses").insert({
    date,
    amount,
    description,
    // Honor an explicit category typed into the form; otherwise let the
    // rules tag it for us.
    category: category || categorizeExpense(description),
    source: "manual",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/finance");
}

export type RecategorizeResult =
  | { ok: true; updated: number; total: number }
  | { ok: false; error: string };

/**
 * Replays the categorization rules over every expense. Useful after
 * tweaking lib/expense-categorize.ts (e.g. adding a new vendor) or to
 * categorize the historical rows imported before the rules existed.
 */
export async function recategorizeAllExpensesAction(): Promise<RecategorizeResult> {
  try {
    const supabase = await createClient();
    // Expenses crossed 1000 rows in mid-2026 — an unbounded select here
    // silently skipped everything past the cap, so page through.
    const rows = await fetchAllRows<{
      id: string;
      description: string;
      category: string | null;
    }>((from, to) =>
      supabase
        .from("expenses")
        .select("id, description, category")
        .order("id")
        .range(from, to),
    );

    let updated = 0;
    // Walk through and only write the rows whose category would change
    // to keep the round-trips proportional to the work.
    for (const r of rows ?? []) {
      const next = categorizeExpense(r.description);
      if (r.category === next) continue;
      const { error } = await supabase
        .from("expenses")
        .update({ category: next })
        .eq("id", r.id);
      if (error) throw new Error(error.message);
      updated += 1;
    }

    revalidatePath("/finance");
    return { ok: true, updated, total: rows?.length ?? 0 };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Recategorize failed" };
  }
}
