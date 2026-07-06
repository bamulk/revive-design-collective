import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Kinds of events we surface in the admin Activity center. Keep this
 * in sync with the icon / phrasing switch in src/app/(app)/activity.
 */
export type ActivityKind =
  | "stage_status_change"
  | "stage_created"
  | "stage_deleted"
  | "photo_added"
  | "payment_recorded"
  | "stage_client_change";

/**
 * Insert one event into activity_log. Best-effort — failures are
 * logged and swallowed so a logging hiccup never breaks the caller's
 * actual write (status change, photo upload, etc.).
 *
 * Pass `supabase` as a user-bound client; the function fetches the
 * user's profile name/email so the snapshot survives renames later.
 * If stageId is passed, the address is also snapshot for display.
 */
export async function logActivity(
  supabase: SupabaseClient,
  input: {
    kind: ActivityKind;
    stageId?: string | null;
    /** Override the stage address snapshot (e.g. when you already
     *  have it in hand and don't want a re-fetch). */
    stageAddress?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let actorName: string | null = null;
    let actorEmail: string | null = null;
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", user.id)
        .maybeSingle();
      actorName = (profile?.full_name ?? "").trim() || null;
      actorEmail = profile?.email ?? user.email ?? null;
    }

    let stageAddress = input.stageAddress ?? null;
    if (!stageAddress && input.stageId) {
      const { data: s } = await supabase
        .from("stages")
        .select("address")
        .eq("id", input.stageId)
        .maybeSingle();
      stageAddress = s?.address ?? null;
    }

    await supabase.from("activity_log").insert({
      kind: input.kind,
      actor_id: user?.id ?? null,
      actor_name: actorName,
      actor_email: actorEmail,
      stage_id: input.stageId ?? null,
      stage_address: stageAddress,
      details: input.details ?? {},
    });
  } catch (e) {
    console.error("[logActivity]", input.kind, e);
  }
}
