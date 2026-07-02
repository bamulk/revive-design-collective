"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  plaid,
  fetchInstitutionName,
  syncPlaidItem,
  type SyncResult,
} from "@/lib/plaid";

const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://app.revivedesigncollective.com"
);

/**
 * Step 1 of the Plaid Link flow. Mints a short-lived link_token tied
 * to the signed-in admin so we can open Plaid's bank-picker UI on the
 * client.
 */
export async function createPlaidLinkTokenAction(): Promise<
  { ok: true; link_token: string } | { ok: false; error: string }
> {
  await requireAdmin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  try {
    const { data } = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "Revive Design Collective",
      products: ["transactions"] as any,
      country_codes: ["US"] as any,
      language: "en",
      webhook: `${SITE_URL}/api/plaid/webhook`,
    });
    return { ok: true, link_token: data.link_token };
  } catch (e: any) {
    const msg = e?.response?.data?.error_message || e?.message || "Plaid error";
    console.error("[createPlaidLinkTokenAction]", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Step 2 of the Plaid Link flow. The browser calls this with the
 * `public_token` Plaid hands back from a successful Link session. We
 * exchange it for the long-lived access_token, look up the bank name,
 * save the item, and fire an initial transactions sync.
 */
export async function exchangePlaidPublicTokenAction(
  publicToken: string,
): Promise<{ ok: true; synced: SyncResult } | { ok: false; error: string }> {
  await requireAdmin();
  if (!publicToken) return { ok: false, error: "Missing public_token." };

  try {
    const { data: ex } = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = ex.access_token;
    const itemId = ex.item_id;

    const { id: institutionId, name: institutionName } =
      await fetchInstitutionName(accessToken);

    // Upsert on item_id so reconnecting the same bank doesn't dupe.
    const admin = createAdminClient();
    const { data: row, error: upsertErr } = await admin
      .from("plaid_items")
      .upsert(
        {
          item_id: itemId,
          access_token: accessToken,
          institution_id: institutionId,
          institution_name: institutionName,
        },
        { onConflict: "item_id" },
      )
      .select("id, item_id, access_token, cursor")
      .single();
    if (upsertErr || !row) {
      throw new Error(upsertErr?.message || "Couldn't save Plaid item.");
    }

    const synced = await syncPlaidItem(row);
    revalidatePath("/finance");
    return { ok: true, synced };
  } catch (e: any) {
    const msg = e?.response?.data?.error_message || e?.message || "Plaid error";
    console.error("[exchangePlaidPublicTokenAction]", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Disconnect a linked bank. Tells Plaid to invalidate the Item (so we
 * stop being billed for it) and removes our row. We DON'T purge the
 * already-imported expenses — they remain part of the historical
 * record.
 */
export async function disconnectPlaidItemAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("plaid_items")
    .select("id, access_token")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Connection not found." };

  try {
    await plaid.itemRemove({ access_token: row.access_token });
  } catch (e: any) {
    // Plaid /item/remove can return ITEM_NOT_FOUND if the user already
    // removed it on their side — treat as success.
    const code = e?.response?.data?.error_code;
    if (code && code !== "ITEM_NOT_FOUND") {
      console.error("[disconnectPlaidItemAction itemRemove]", e?.response?.data);
    }
  }

  const { error } = await admin.from("plaid_items").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/finance");
  return { ok: true };
}

/** Manual "sync now" trigger (e.g. after reconnecting a bank). */
export async function syncPlaidItemAction(
  id: string,
): Promise<{ ok: true; synced: SyncResult } | { ok: false; error: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("plaid_items")
    .select("id, item_id, access_token, cursor")
    .eq("id", id)
    .maybeSingle();
  if (error || !row) return { ok: false, error: "Connection not found." };
  const synced = await syncPlaidItem(row);
  revalidatePath("/finance");
  return { ok: true, synced };
}
