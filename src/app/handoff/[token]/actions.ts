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
 * The agent keeps the stage: they sign and pay. Consumes the token and
 * sends the agreement to them. Nothing was sent before this point.
 */
export async function keepForSelfAction(token: string): Promise<HandoffResult> {
  try {
    const t = (token || "").trim();
    if (t.length < 16) return { ok: false, error: "Invalid link." };

    const sb = admin();
    const { data: stage } = await sb
      .from("stages")
      .select("id, client:clients(email)")
      .eq("handoff_token", t)
      .maybeSingle();
    if (!stage) {
      return {
        ok: false,
        error: "This link has already been used or is no longer valid.",
      };
    }
    const client = Array.isArray(stage.client) ? stage.client[0] : stage.client;
    if (!(client as { email?: string | null } | null)?.email) {
      return {
        ok: false,
        error:
          "We don't have an email on file for you — please contact us and we'll sort it out.",
      };
    }

    // No homeowner override: the stage's client (the agent) stays the
    // signer and payer. Stamp the decision + consume the token.
    const { error: upErr } = await sb
      .from("stages")
      .update({
        handoff_completed_at: new Date().toISOString(),
        handoff_token: null,
        handoff_token_consumed: t,
      })
      .eq("id", stage.id);
    if (upErr) return { ok: false, error: upErr.message };

    if (isSignatureConfigured()) {
      try {
        await sendSignatureFromStage(sb as never, stage.id);
      } catch (e) {
        console.error("[keepForSelfAction] signature send failed:", e);
      }
    }

    revalidatePath(`/handoff/${t}`);
    return { ok: true };
  } catch (e: any) {
    console.error("keepForSelfAction failed:", e);
    return { ok: false, error: e?.message || "Something went wrong." };
  }
}

/**
 * The agent passes the stage to their seller. Stores the seller as the
 * stage's recipient override, consumes the token, and sends them the
 * agreement — which then names the seller as the signing party, and
 * whose invoice goes to them too.
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

    // Send the agreement to the seller. Nothing went out before this
    // choice. Best-effort: the decision is recorded either way, and
    // staff can resend from the stage page if this fails.
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
