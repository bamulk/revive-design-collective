"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-admin";

export type CalendarEventResult = { ok: true } | { ok: false; error: string };

/** Add a manual (non-stage) calendar entry. Admin only. */
export async function createCalendarEventAction(input: {
  title: string;
  eventDate: string;
  endDate?: string | null;
  note?: string | null;
}): Promise<CalendarEventResult> {
  try {
    await requireAdmin();
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("calendar_events").insert({
      title,
      event_date: eventDate,
      end_date: endDate,
      note: (input.note || "").trim() || null,
      created_by: user?.id ?? null,
    });
    if (error) return { ok: false, error: error.message };

    revalidatePath("/stages/calendar");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Couldn't add the event" };
  }
}

/** Remove a manual calendar entry. Admin only. */
export async function deleteCalendarEventAction(
  id: string,
): Promise<CalendarEventResult> {
  try {
    await requireAdmin();
    const supabase = await createClient();
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
