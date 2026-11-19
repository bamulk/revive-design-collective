"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireTeamMember } from "@/lib/permissions";

export type CalendarEventResult = { ok: true } | { ok: false; error: string };

/** Add a manual (non-stage) calendar entry. Any team member. */
export async function createCalendarEventAction(input: {
  title: string;
  eventDate: string;
  endDate?: string | null;
  note?: string | null;
}): Promise<CalendarEventResult> {
  try {
    const { userId } = await requireTeamMember();
    const title = (input.title || "").trim();
    const eventDate = (input.eventDate || "").trim();
    if (!title) return { ok: false, error: "Enter a title." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      return { ok: false, error: "Pick a date." };
    }
    const endDate = (input.endDate || "").trim() || null;
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return { ok: false, error: "End date isn't valid." };
    }
    if (endDate && endDate < eventDate) {
      return { ok: false, error: "End date can't be before the start date." };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("calendar_events").insert({
      title: title.slice(0, 200),
      event_date: eventDate,
      end_date: endDate,
      note: (input.note || "").trim().slice(0, 500) || null,
      // Recorded so the person who added it can remove it later.
      created_by: userId,
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath("/stages/calendar");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Couldn't add the event" };
  }
}

/**
 * Remove a manual calendar entry. Admins can remove any entry; anyone
 * else only the ones they added. (The database enforces the same rule.)
 */
export async function deleteCalendarEventAction(
  id: string,
): Promise<CalendarEventResult> {
  try {
    const { userId } = await requireTeamMember();
    const supabase = await createClient();
    const [{ data: me }, { data: ev }] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", userId).single(),
      supabase.from("calendar_events").select("created_by").eq("id", id).maybeSingle(),
    ]);
    if (!ev) return { ok: false, error: "That entry is already gone." };
    if (me?.role !== "admin" && ev.created_by !== userId) {
      return { ok: false, error: "You can only remove entries you added." };
    }
    const { error } = await supabase
      .from("calendar_events")
      .delete()
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/stages/calendar");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Couldn't remove the event" };
  }
}
