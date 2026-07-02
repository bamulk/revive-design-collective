"use server";

import { revalidatePath } from "next/cache";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { sendSignatureFromStage } from "@/lib/signature-send-core";
import { isSignatureConfigured } from "@/lib/signature";

/**
 * Anonymous accept/decline actions for the public estimate page.
 * They identify the row by the high-entropy estimate_token and only
 * operate on stages currently in status='estimate', so a leaked URL
 * can't flip a real stage's status.
 *
 * Uses the service role key (server-only) so anonymous visitors can
 * write back without an auth session. The token itself is the secret.
 */
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials missing");
  return createAdminClient(url, key, { auth: { persistSession: false } });
}

export type EstimateActionResult =
  | { ok: true; status: "scheduled" | "declined" }
  | { ok: false; error: string };

export async function acceptEstimateByToken(
  token: string
): Promise<EstimateActionResult> {
  try {
    if (!token || token.length < 16) throw new Error("Invalid link");
    const sb = admin();
    const { data: stage, error: fetchErr } = await sb
      .from("stages")
      .select("id, status")
      .eq("estimate_token", token)
      .single();
    if (fetchErr || !stage) throw new Error("Estimate not found");
    if (stage.status !== "estimate") {
      throw new Error("This estimate has already been processed.");
    }

    const { error } = await sb
      .from("stages")
      .update({
        status: "scheduled",
        estimate_accepted_at: new Date().toISOString(),
        // Wipe the token so the public link stops working once accepted.
        estimate_token: null,
      })
      .eq("id", stage.id);
    if (error) throw new Error(error.message);

    // Best-effort: fire the e-signature envelope so the client gets
    // the staging agreement to sign right after they accept. Failures
    // here don't undo the acceptance — admin can manually re-send from
    // the stage detail page.
    if (isSignatureConfigured()) {
      try {
        await sendSignatureFromStage(sb, stage.id);
      } catch (e) {
        console.warn(
          "Signature auto-send after estimate accept failed:",
          (e as Error)?.message ?? e
        );
      }
    }

    revalidatePath(`/e/${token}`);
    revalidatePath("/estimates");
    revalidatePath(`/stages/${stage.id}`);
    return { ok: true, status: "scheduled" };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Accept failed" };
  }
}

export async function declineEstimateByToken(
  token: string
): Promise<EstimateActionResult> {
  try {
    if (!token || token.length < 16) throw new Error("Invalid link");
    const sb = admin();
    const { data: stage, error: fetchErr } = await sb
      .from("stages")
      .select("id, status")
      .eq("estimate_token", token)
      .single();
    if (fetchErr || !stage) throw new Error("Estimate not found");
    if (stage.status !== "estimate") {
      throw new Error("This estimate has already been processed.");
    }

    const { error } = await sb
      .from("stages")
      .update({
        status: "cancelled",
        estimate_declined_at: new Date().toISOString(),
        estimate_token: null,
      })
      .eq("id", stage.id);
    if (error) throw new Error(error.message);

    revalidatePath(`/e/${token}`);
    revalidatePath("/estimates");
    return { ok: true, status: "declined" };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Decline failed" };
  }
}
