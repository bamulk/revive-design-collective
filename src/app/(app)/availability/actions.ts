"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTeamRole, TEAM_ROLES } from "@/lib/permissions";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AvailabilityResult = { ok: true } | { ok: false; error: string };

/**
 * Resolve which stager's availability is being written and which client
 * to use:
 *  - editing your own (no target, or target == self): the cookie client,
 *    so RLS own-row policies apply.
 *  - an admin editing a stager's schedule (target != self): verify the
 *    caller is an admin and the target is a real team member, then use
 *    the service-role client (RLS only permits own-row writes).
 */
async function resolveWriter(
  targetStagerId: string | undefined,
): Promise<{ db: SupabaseClient; stagerId: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!isTeamRole(me?.role)) return { error: "Not authorized." };

  const target = targetStagerId ?? user.id;
  if (target === user.id) {
    return { db: supabase, stagerId: user.id };
  }

  // Editing someone else — admins only, and only real team members.
  if (me?.role !== "admin") return { error: "Not authorized." };
  const admin = createAdminClient();
  const { data: targetProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", target)
    .single();
  if (!targetProfile || !TEAM_ROLES.includes(targetProfile.role)) {
    return { error: "That person isn't a stager." };
  }
  return { db: admin, stagerId: target };
}

function done(): AvailabilityResult {
  revalidatePath("/availability");
  revalidatePath("/plan");
  return { ok: true };
}

/**
 * Set recurring availability for a weekday (0=Sun .. 6=Sat). `available`
 * true adds the weekday to the schedule, false removes it.
 */
export async function setWeekdayAvailabilityAction(
  weekday: number,
  available: boolean,
  targetStagerId?: string,
): Promise<AvailabilityResult> {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return { ok: false, error: "Invalid weekday." };
  }
  try {
    const w = await resolveWriter(targetStagerId);
    if ("error" in w) return { ok: false, error: w.error };

    if (available) {
      const { error } = await w.db
        .from("stager_weekly_availability")
        .upsert(
          { stager_id: w.stagerId, weekday },
          { onConflict: "stager_id,weekday", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await w.db
        .from("stager_weekly_availability")
        .delete()
        .eq("stager_id", w.stagerId)
        .eq("weekday", weekday);
      if (error) throw new Error(error.message);
    }
    return done();
  } catch (e: any) {
    return { ok: false, error: e?.message || "Couldn't save schedule." };
  }
}

/**
 * Set a one-off override for a specific date — marks that single day on
 * or off regardless of the weekly schedule.
 */
export async function setDayOverrideAction(
  date: string,
  available: boolean,
  targetStagerId?: string,
): Promise<AvailabilityResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Invalid date." };
  }
  try {
    const w = await resolveWriter(targetStagerId);
    if ("error" in w) return { ok: false, error: w.error };

    const { error } = await w.db
      .from("stager_availability")
      .upsert(
        { stager_id: w.stagerId, date, available },
        { onConflict: "stager_id,date" },
      );
    if (error) throw new Error(error.message);
    return done();
  } catch (e: any) {
    return { ok: false, error: e?.message || "Couldn't save availability." };
  }
}

/** Clear a date's override so it falls back to the weekly schedule. */
export async function clearDayOverrideAction(
  date: string,
  targetStagerId?: string,
): Promise<AvailabilityResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Invalid date." };
  }
  try {
    const w = await resolveWriter(targetStagerId);
    if ("error" in w) return { ok: false, error: w.error };

    const { error } = await w.db
      .from("stager_availability")
      .delete()
      .eq("stager_id", w.stagerId)
      .eq("date", date);
    if (error) throw new Error(error.message);
    return done();
  } catch (e: any) {
    return { ok: false, error: e?.message || "Couldn't update availability." };
  }
}
