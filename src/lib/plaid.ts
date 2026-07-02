/**
 * Plaid integration helpers.
 *
 *   - `plaid` is the singleton API client used by every Plaid call.
 *   - `syncPlaidItem` pulls new/modified/removed transactions for one
 *     linked bank Item using /transactions/sync (cursor-based, so it
 *     only ships the delta since last sync), writes them into the
 *     `expenses` table, and persists the new cursor for next time.
 *
 * All DB writes use the SERVICE-ROLE admin client because syncs run
 * from webhook + cron contexts where there's no user session.
 *
 * Plaid amount sign convention: POSITIVE = money leaving the account
 * (a debit / expense). NEGATIVE = a credit / refund. We only model
 * expenses, so credits are skipped — bank-level inflows aren't tracked
 * separately here (the app's revenue lives on `stages.paid_at`).
 */

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  type Transaction,
} from "plaid";
import { createAdminClient } from "@/lib/supabase/admin";

const env = (process.env.PLAID_ENV || "sandbox").toLowerCase();
const basePath =
  PlaidEnvironments[env as keyof typeof PlaidEnvironments] ||
  PlaidEnvironments.sandbox;

export const plaid = new PlaidApi(
  new Configuration({
    basePath,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID ?? "",
        "PLAID-SECRET": process.env.PLAID_SECRET ?? "",
      },
    },
  }),
);

/**
 * Best-effort mapping from Plaid's `personal_finance_category` to the
 * app's existing category strings (Payroll, Gas, Inventory). Anything
 * we don't recognize falls back to "Uncategorized" so the user can
 * relabel on the finance page.
 */
export function mapPlaidCategory(
  detailed: string | null | undefined,
  primary: string | null | undefined,
  rawName: string | null | undefined,
): string {
  const d = (detailed || "").toUpperCase();
  const p = (primary || "").toUpperCase();
  const n = (rawName || "").toUpperCase();

  // Direct matches on Plaid's detailed enum.
  if (d.includes("PAYROLL")) return "Payroll";
  if (d === "TRANSPORTATION_GAS" || d.includes("_GAS")) return "Gas";
  if (
    d.includes("HOME_FURNISHING") ||
    d.includes("FURNITURE") ||
    d.includes("HOME_IMPROVEMENT")
  ) {
    return "Inventory";
  }

  // Heuristics on the transaction name for the common cases Plaid's
  // category alone misses (e.g. Bank of America posts payroll as a
  // generic transfer with the processor name in the description).
  if (/GUSTO|ADP|PAYCHEX|PAYROLL|RIPPLING|GUSTO\s*PAY/.test(n)) {
    return "Payroll";
  }
  if (/\bSHELL\b|CHEVRON|ARCO|76 GAS|EXXON|VALERO|MOBIL/.test(n)) {
    return "Gas";
  }
  if (/IKEA|WAYFAIR|TARGET|HOMEGOODS|HOME DEPOT|LOWE/.test(n)) {
    return "Inventory";
  }

  // Coarser fallbacks by primary category.
  if (p === "TRANSPORTATION") return "Gas";
  if (p === "GENERAL_MERCHANDISE") return "Inventory";
  if (p === "HOME_IMPROVEMENT") return "Inventory";

  return "Uncategorized";
}

type ExpenseRow = {
  plaid_transaction_id: string;
  plaid_account_id: string | null;
  date: string; // YYYY-MM-DD
  amount: number; // positive dollars (expense)
  description: string;
  category: string;
  source: string;
  pending: boolean;
};

function txToExpenseRow(t: Transaction): ExpenseRow | null {
  // Plaid: amount > 0 = money OUT of the account. We model expenses
  // only, so skip credits/refunds (would inflate "out" math otherwise).
  if (typeof t.amount !== "number" || t.amount <= 0) return null;

  const pfc = (t as any).personal_finance_category as
    | { detailed?: string; primary?: string }
    | undefined;
  const name = (t.merchant_name || t.name || "Bank transaction").trim();

  return {
    plaid_transaction_id: t.transaction_id,
    plaid_account_id: t.account_id ?? null,
    date: t.date, // YYYY-MM-DD per Plaid spec
    amount: Number(t.amount.toFixed(2)),
    description: name,
    category: mapPlaidCategory(pfc?.detailed, pfc?.primary, name),
    source: "plaid",
    pending: !!t.pending,
  };
}

export type SyncResult = {
  added: number;
  modified: number;
  removed: number;
  error?: string;
};

/**
 * Pull every new/modified/removed transaction for one Plaid Item via
 * /transactions/sync, mirror them into `expenses`, and persist the new
 * cursor. Idempotent — re-running won't double-insert because
 * expenses.plaid_transaction_id is UNIQUE.
 */
export async function syncPlaidItem(item: {
  id: string;
  item_id: string;
  access_token: string;
  cursor: string | null;
}): Promise<SyncResult> {
  const admin = createAdminClient();
  const result: SyncResult = { added: 0, modified: 0, removed: 0 };
  let cursor: string | undefined = item.cursor ?? undefined;

  try {
    // Plaid's recommended pattern: page through until has_more=false,
    // saving the cursor after each successful batch.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data } = await plaid.transactionsSync({
        access_token: item.access_token,
        cursor,
        // Include personal_finance_category in returned txs.
        options: { include_personal_finance_category: true } as any,
      });

      // --- ADDED transactions → upsert into expenses
      const addedRows = (data.added ?? [])
        .map(txToExpenseRow)
        .filter((r): r is ExpenseRow => r !== null);
      if (addedRows.length > 0) {
        const { error } = await admin
          .from("expenses")
          .upsert(addedRows, {
            onConflict: "plaid_transaction_id",
            ignoreDuplicates: true,
          });
        if (error) throw new Error(`expenses insert: ${error.message}`);
        result.added += addedRows.length;
      }

      // --- MODIFIED transactions → patch the existing expense rows
      for (const t of data.modified ?? []) {
        const row = txToExpenseRow(t);
        if (!row) continue;
        const { error } = await admin
          .from("expenses")
          .update({
            date: row.date,
            amount: row.amount,
            description: row.description,
            pending: row.pending,
          })
          .eq("plaid_transaction_id", t.transaction_id);
        if (!error) result.modified += 1;
      }

      // --- REMOVED transactions → delete by Plaid id
      const removedIds = (data.removed ?? [])
        .map((r) => r.transaction_id)
        .filter((id): id is string => !!id);
      if (removedIds.length > 0) {
        const { error } = await admin
          .from("expenses")
          .delete()
          .in("plaid_transaction_id", removedIds);
        if (!error) result.removed += removedIds.length;
      }

      // Persist cursor + last_synced_at after each successful page so a
      // failure mid-pagination doesn't replay the whole tail next time.
      cursor = data.next_cursor;
      await admin
        .from("plaid_items")
        .update({
          cursor,
          last_synced_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", item.id);

      if (!data.has_more) break;
    }
  } catch (e: any) {
    const message = e?.response?.data?.error_message || e?.message || "Sync failed";
    console.error(`[plaid sync ${item.item_id}]`, message);
    await admin
      .from("plaid_items")
      .update({ last_error: message })
      .eq("id", item.id);
    result.error = message;
  }

  return result;
}

/**
 * Resolve a friendly institution name for a freshly-exchanged Item.
 * Best-effort — returns null on failure so the connect flow still
 * succeeds even if the name lookup hiccups.
 */
export async function fetchInstitutionName(
  accessToken: string,
): Promise<{ id: string | null; name: string | null }> {
  try {
    const { data: itemData } = await plaid.itemGet({ access_token: accessToken });
    const institutionId = itemData.item.institution_id ?? null;
    if (!institutionId) return { id: null, name: null };
    const { data: inst } = await plaid.institutionsGetById({
      institution_id: institutionId,
      country_codes: ["US"] as any,
    });
    return { id: institutionId, name: inst.institution.name ?? null };
  } catch (e) {
    console.error("[fetchInstitutionName]", e);
    return { id: null, name: null };
  }
}
