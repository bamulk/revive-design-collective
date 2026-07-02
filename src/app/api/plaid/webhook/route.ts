import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { plaid, syncPlaidItem } from "@/lib/plaid";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
// Webhook payloads are small but must be processed with the raw body
// preserved (signature covers SHA-256 of the body). Don't cache.
export const dynamic = "force-dynamic";

/**
 * Plaid webhook receiver. We treat any verified TRANSACTIONS event
 * (sync, default, historical, initial) as "go sync this Item" and let
 * the cursor-based /transactions/sync logic figure out what actually
 * changed.
 *
 * Verification follows Plaid's recommended flow:
 *   1. Read JWT from the Plaid-Verification header.
 *   2. Look up the signing key by `kid` via /webhook_verification_key/get.
 *   3. Verify ES256 signature against the request body's SHA-256.
 * Unverified requests are rejected with 400 so a stranger can't fire
 * arbitrary syncs (or worse) against our items.
 */
export async function POST(req: NextRequest) {
  const signatureToken = req.headers.get("plaid-verification");
  const rawBody = await req.text();

  if (!signatureToken) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  let verified: { request_body_sha256?: string } | null = null;
  try {
    const header = decodeProtectedHeader(signatureToken);
    if (!header.kid) throw new Error("missing kid");

    const { data: keyResp } = await plaid.webhookVerificationKeyGet({
      key_id: header.kid as string,
    });
    const jwk = keyResp.key as any;

    const key = await importJWK(jwk, "ES256");
    const { payload } = await jwtVerify(signatureToken, key, {
      algorithms: ["ES256"],
    });

    // Plaid puts the request body's SHA-256 in the JWT claim. Compare
    // to a freshly-hashed body to make sure no one tampered with the
    // payload between signing and us.
    const expected = (payload as any).request_body_sha256 as
      | string
      | undefined;
    const actual = createHash("sha256").update(rawBody).digest("hex");
    if (!expected || expected !== actual) {
      throw new Error("body sha256 mismatch");
    }

    verified = payload as any;
  } catch (e: any) {
    console.error("[plaid webhook verify]", e?.message || e);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  if (!verified) {
    return NextResponse.json({ error: "unverified" }, { status: 401 });
  }

  // Parse the payload AFTER verification.
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const itemId = body.item_id as string | undefined;
  const webhookType = body.webhook_type as string | undefined;

  if (!itemId || webhookType !== "TRANSACTIONS") {
    // Acknowledge non-transaction webhooks (ITEM, AUTH, etc.) so Plaid
    // stops retrying; nothing to do for them today.
    return NextResponse.json({ ok: true, ignored: webhookType ?? "unknown" });
  }

  const admin = createAdminClient();
  const { data: item, error } = await admin
    .from("plaid_items")
    .select("id, item_id, access_token, cursor")
    .eq("item_id", itemId)
    .maybeSingle();
  if (error || !item) {
    console.warn("[plaid webhook] no item for", itemId);
    return NextResponse.json({ ok: true, missing: true });
  }

  const synced = await syncPlaidItem(item);
  return NextResponse.json({ ok: true, synced });
}
