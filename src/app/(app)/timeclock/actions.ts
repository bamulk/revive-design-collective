"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTeamMember } from "@/lib/permissions";

/** Clock the current user in. No-op if already clocked in. */
export async function clockInAction() {
  const { userId } = await requireTeamMember();
  const supabase = await createClient();

  const { data: open } = await supabase
    .from("time_entries")
    .select("id")
    .eq("user_id", userId)
    .is("clock_out", null)
    .maybeSingle();
  if (!open) {
    const { error } = await supabase.from("time_entries").insert({
      user_id: userId,
      clock_in: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/timeclock");
}

/** Clock the current user out (closes their open entry). */
export async function clockOutAction() {
  const { userId } = await requireTeamMember();
  const supabase = await createClient();
  const { error } = await supabase
    .from("time_entries")
    .update({ clock_out: new Date().toISOString() })
    .eq("user_id", userId)
    .is("clock_out", null);
  if (error) throw new Error(error.message);
  revalidatePath("/timeclock");
}

/** Delete a time entry. RLS limits this to the owner (or an admin). */
export async function deleteEntryAction(entryId: string) {
  await requireTeamMember();
  const supabase = await createClient();
  const { error } = await supabase
    .from("time_entries")
    .delete()
    .eq("id", entryId);
  if (error) throw new Error(error.message);
  revalidatePath("/timeclock");
}

/**
 * Manually add a completed entry for the current user (e.g. forgot to
 * clock in). The client passes ISO timestamps already converted from the
 * user's local (Pacific) wall-clock inputs.
 */
export async function addEntryAction(
  clockInISO: string,
  clockOutISO: string,
) {
  const { userId } = await requireTeamMember();
  const ci = new Date(clockInISO);
  const co = new Date(clockOutISO);
  if (
    Number.isNaN(ci.getTime()) ||
    Number.isNaN(co.getTime()) ||
    co.getTime() <= ci.getTime()
  ) {
    throw new Error("Clock-out must be after clock-in.");
  }
  const supabase = await createClient();
  const { error } = await supabase.from("time_entries").insert({
    user_id: userId,
    clock_in: ci.toISOString(),
    clock_out: co.toISOString(),
    edited: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/timeclock");
}

/**
 * Edit an entry's clock-in / clock-out times. RLS limits this to the
 * owner (their own entries) or an admin (any entry). The client passes
 * ISO timestamps already converted from local (Pacific) wall-clock inputs.
 */
export async function updateEntryAction(
  entryId: string,
  clockInISO: string,
  clockOutISO: string,
) {
  await requireTeamMember();
  const ci = new Date(clockInISO);
  const co = new Date(clockOutISO);
  if (
    Number.isNaN(ci.getTime()) ||
    Number.isNaN(co.getTime()) ||
    co.getTime() <= ci.getTime()
  ) {
    throw new Error("Clock-out must be after clock-in.");
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("time_entries")
    .update({
      clock_in: ci.toISOString(),
      clock_out: co.toISOString(),
      edited: true,
    })
    .eq("id", entryId);
  if (error) throw new Error(error.message);
  revalidatePath("/timeclock");
}
