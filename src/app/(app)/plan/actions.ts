"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTeamMember } from "@/lib/permissions";
import { notifyStagerAssignment } from "@/lib/notify";

const INTERNAL_ROLES = ["admin", "stager", "lead_stager"];

export type TeamKey = "grey" | "white" | "little";

const VALID_TEAMS: TeamKey[] = ["grey", "white", "little"];

/**
 * Assign a job (stage OR destage) to one of the three teams plus the
 * specific stagers on that crew. Stage-day assignments live on
 * (team, assigned_stager_ids); destage-day assignments live on
 * (destage_team, destage_stager_ids) so the same house can have a
 * different crew for staging vs destaging.
 *
 * Passing `null` for team clears the assignment (and the stager list
 * along with it — a job with no team can't have stagers either).
 *
 * After a successful update, fires a best-effort push/SMS to any
 * newly-added stager via notifyStagerAssignment.
 */
export async function assignTeamAction(input: {
  stageId: string;
  kind: "stage" | "destage";
  team: TeamKey | null;
  stagerIds: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Any team member can assign crew (from the stage page). Admins also use
  // this from the Plan page.
  await requireTeamMember();

  const { stageId, kind, team, stagerIds } = input;
  if (team !== null && !VALID_TEAMS.includes(team)) {
    return { ok: false, error: "Invalid team." };
  }

  const teamCol = kind === "destage" ? "destage_team" : "team";
  const stagerCol =
    kind === "destage" ? "destage_stager_ids" : "assigned_stager_ids";

  const supabase = await createClient();

  // Read the previous stager list so we can detect newly-added ids
  // for the notification. Done before the update so the diff is
  // accurate. Failure to read just falls back to "no prior list"
  // (everyone is treated as newly added).
  const { data: prev } = await supabase
    .from("stages")
    .select(stagerCol)
    .eq("id", stageId)
    .single();
  const oldStagerIds: string[] = Array.isArray(
    (prev as any)?.[stagerCol],
  )
    ? ((prev as any)[stagerCol] as string[])
    : [];

  const nextStagerIds = team === null ? [] : stagerIds;
  const { error } = await supabase
    .from("stages")
    .update({
      [teamCol]: team,
      [stagerCol]: nextStagerIds,
    })
    .eq("id", stageId);

  if (error) return { ok: false, error: error.message };

  // Fire-and-forget. Wrapped in try/catch so a Twilio / VAPID hiccup
  // never breaks the assignment write.
  try {
    await notifyStagerAssignment({
      stageId,
      kind,
      oldStagerIds,
      newStagerIds: nextStagerIds,
    });
  } catch (e) {
    console.error("[assignTeamAction] notifyStagerAssignment failed:", e);
  }

  revalidatePath("/plan");
  revalidatePath(`/stages/${stageId}`);
  return { ok: true };
}

/**
 * Stager self-assignment: lets any internal user (admin, stager, or
 * lead_stager) toggle themselves on or off a stage's stage/destage
 * crew. Doesn't touch the team — admins still own that — so calling
 * this on a stage with no team set just adds the user to the stager
 * list; the admin can pick a team afterwards. Skips the
 * stager-assignment notification (the assignee already knows).
 */
export async function toggleSelfStagerAssignmentAction(input: {
  stageId: string;
  kind: "stage" | "destage";
}): Promise<{ ok: true; assigned: boolean } | { ok: false; error: string }> {
  const { stageId, kind } = input;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !INTERNAL_ROLES.includes(profile.role ?? "")) {
    return { ok: false, error: "Not authorized." };
  }

  const stagerCol =
    kind === "destage" ? "destage_stager_ids" : "assigned_stager_ids";

  const { data: prev, error: readErr } = await supabase
    .from("stages")
    .select(stagerCol)
    .eq("id", stageId)
    .single();
  if (readErr || !prev) {
    return { ok: false, error: readErr?.message || "Stage not found." };
  }
  const current: string[] = Array.isArray((prev as any)[stagerCol])
    ? ((prev as any)[stagerCol] as string[])
    : [];
  const already = current.includes(user.id);
  const next = already
    ? current.filter((x) => x !== user.id)
    : [...current, user.id];

  const { error } = await supabase
    .from("stages")
    .update({ [stagerCol]: next })
    .eq("id", stageId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/plan");
  revalidatePath(`/stages/${stageId}`);
  return { ok: true, assigned: !already };
}
