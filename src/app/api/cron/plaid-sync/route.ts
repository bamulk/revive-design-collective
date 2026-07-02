import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncPlaidItem } from "@/lib/plaid";

/**
 * Daily backup sync for every linked Plaid Item. Plaid's webhook is
 * the primary trigger; this cron is a belt-and-suspenders fallback in
 * case a webhook is missed (delivery failures, item errors, etc.).
 *
 * Auth via CRON_SECRET bearer header — matches the other cron routes
 * and is exempt from the proxy session check.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const { data: items, error } = await admin
    .from("plaid_items")
    .select("id, item_id, access_token, cursor");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{
    item_id: string;
    added: number;
    modified: number;
    removed: number;
    error?: string;
  }> = [];
  for (const it of items ?? []) {
    const r = await syncPlaidItem(it);
    results.push({ item_id: it.item_id, ...r });
  }
  return NextResponse.json({ ok: true, count: results.length, results });
}
