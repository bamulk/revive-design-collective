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

export type IntakeResult = { ok: true } | { ok: false; error: string };

/**
 * Public (no-auth) submit for the realtor intake form. The realtor enters
 * the homeowner's name + email; we store them as the stage's recipient
 * override, consume the token, and fire the e-signature to the homeowner.
 */
export async function submitIntakeAction(input: {
  token: string;
  homeownerName: string;
  homeownerEmail: string;
}): Promise<IntakeResult> {
  try {
    const token = (input.token || "").trim();
    if (token.length < 16) return { ok: false, error: "Invalid link." };
    const name = (input.homeownerName || "").trim();
    const email = (input.homeownerEmail || "").trim().toLowerCase();
    if (!name) return { ok: false, error: "Enter the homeowner's name." };
    if (!EMAIL_RE.test(email)) {
      return { ok: false, error: "Enter a valid homeowner email." };
    }

    const sb = admin();
    const { data: stage } = await sb
      .from("stages")
      .select("id, intake_token")
      .eq("intake_token", token)
      .maybeSingle();
    if (!stage) {
      return {
        ok: false,
        error: "This link has already been used or is no longer valid.",
      };
    }

    // Store the homeowner + consume the token (moved to _consumed so the
    // page can still render its "thanks" state on a refresh).
    const { error: upErr } = await sb
      .from("stages")
      .update({
        homeowner_name: name,
        homeowner_email: email,
        intake_completed_at: new Date().toISOString(),
        intake_token: null,
        intake_token_consumed: token,
      })
      .eq("id", stage.id);
    if (upErr) return { ok: false, error: upErr.message };

    // Send the agreement to the homeowner (best-effort). The invoice
    // follows automatically once they sign (signatures webhook).
    if (isSignatureConfigured()) {
      try {
        await sendSignatureFromStage(sb as never, stage.id);
      } catch (e) {
        console.error("[submitIntakeAction] signature send failed:", e);
      }
    }

    revalidatePath(`/intake/${token}`);
    return { ok: true };
  } catch (e: any) {
    console.error("submitIntakeAction failed:", e);
    return { ok: false, error: e?.message || "Something went wrong." };
  }
}
