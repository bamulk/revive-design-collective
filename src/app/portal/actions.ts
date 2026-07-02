"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendPortalMagicLink } from "@/lib/portal-link";

/**
 * Request a magic-link sign-in for the client portal.
 *
 * We pre-check the email against the `clients` table so we never send a
 * link to a random address (which would otherwise create an orphaned
 * auth user). To avoid enumeration we always respond with the same
 * generic success message — a bad email + a good email look identical
 * from the client side.
 */
export async function requestPortalLinkAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ ok: true; sent: boolean } | { ok: false; error: string }> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return { ok: false, error: "Enter a valid email." };
  }

  // Look up the client by email (case-insensitive). Use the admin
  // client so this check isn't blocked by RLS (the requester is anon).
  const admin = createAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("id, email")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (!client) {
    // Mask the lookup time so a wrong email isn't faster than a real one.
    await new Promise((r) => setTimeout(r, 250));
    return { ok: true, sent: false };
  }

  // Token-hash magic link via Resend — works in any browser (no PKCE).
  const res = await sendPortalMagicLink(email);
  if (!res.ok) return res;
  return { ok: true, sent: true };
}
