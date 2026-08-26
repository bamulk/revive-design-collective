"use server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { sendSignatureFromStage } from "@/lib/signature-send-core";
import { isSignatureConfigured } from "@/lib/signature";

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createAdminClient(url, key, { auth: { persistSession: false } });
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type HandoffResult = { ok: true } | { ok: false; error: string };

/**
 * Public (no-auth) submit for the agent handoff form. The agent enters
 * the seller's name + email; we store them as the stage's recipient
 * override, consume the token, and send a FRESH agreement naming the
 * seller as the signing party. The old envelope is superseded — the
 * stage's signature_envelope_id is overwritten, so even if someone
 * signs the stale one the webhook won't match it to this stage.
 */
export async function submitHandoffAction(input: {
  token: string;
  sellerName: string;
  sellerEmail: string;
}): Promise<HandoffResult> {
  try {
    const token = (input.token || "").trim();
    if (token.length < 16) return { ok: false, error: "Invalid link." };
    const name = (input.sellerName || "").trim();
    const email = (input.sellerEmail || "").trim().toLowerCase();
    if (!name) return { ok: false, error: "Enter the seller's name." };
    if (!EMAIL_RE.test(email)) {
      return { ok: false, error: "Enter a valid seller email." };
    }

    const sb = admin();
    const { data: stage } = await sb
      .from("stages")
      .select("id, client:clients(email)")
      .eq("handoff_token", token)
      .maybeSingle();
    if (!stage) {
      return {
        ok: false,
        error: "This link has already been used or is no longer valid.",
      };
    }

    // Don't let the agent hand off to themselves — that would just
    // re-send the same agreement to the same inbox.
    const client = Array.isArray(stage.client) ? stage.client[0] : stage.client;
    const agentEmail = (client as { email?: string | null } | null)?.email;
    if (agentEmail && agentEmail.toLowerCase() === email) {
      return {
        ok: false,
        error:
          "That's your own email — enter the seller's address to hand this off.",
      };
    }

    const { error: upErr } = await sb
      .from("stages")
      .update({
        homeowner_name: name,
        homeowner_email: email,
        handoff_completed_at: new Date().toISOString(),
        handoff_token: null,
        handoff_token_consumed: token,
      })
      .eq("id", stage.id);
    if (upErr) return { ok: false, error: upErr.message };

    // Fresh agreement to the seller. Best-effort: the handoff is already
    // recorded, and staff can resend from the stage page if this fails.
    if (isSignatureConfigured()) {
      try {
        await sendSignatureFromStage(sb as never, stage.id);
      } catch (e) {
        console.error("[submitHandoffAction] signature send failed:", e);
      }
    }

    revalidatePath(`/handoff/${token}`);
    return { ok: true };
  } catch (e: any) {
    console.error("submitHandoffAction failed:", e);
    return { ok: false, error: e?.message || "Something went wrong." };
  }
}
