/**
 * Notification dispatcher for stage events.
 *
 * Admins are notified via Web Push (free; requires the PWA installed +
 * permission granted). Push fails silently if its config is missing so
 * the calling code never has to gate on env vars.
 *
 * (SMS via Twilio was removed — it was unused. The
 * `sms_notifications_enabled` profile flag is kept as the general
 * "do they want notifications at all" opt-in.)
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUsers, isPushConfigured } from "@/lib/push";
import { todayPacificISO, addDaysISO } from "@/lib/time";
import { crewHorizonISO } from "@/lib/crew-horizon";

const APP_NAME = "Revive Design Collective";

function statusLabel(status: string): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "staged":
      return "Staged";
    case "destaged":
      return "Destages";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

/**
 * Admin user IDs (for push), gated by the notifications opt-in flag.
 */
async function getAdminUserIds(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, sms_notifications_enabled")
    .eq("role", "admin")
    .eq("sms_notifications_enabled", true);
  return (data ?? []).map((r: any) => r.id);
}

/**
 * Notify admins via push when a stage status changes.
 */
export async function notifyStatusChange(opts: {
  stageId: string;
  oldStatus: string;
  newStatus: string;
}): Promise<void> {
  if (!isPushConfigured()) return;

  const supabase = createAdminClient();
  const { data: stage } = await supabase
    .from("stages")
    .select("address, city, clients(name)")
    .eq("id", opts.stageId)
    .single();
  if (!stage) return;

  const where = stage.city ? `${stage.address}, ${stage.city}` : stage.address;
  const client = (stage.clients ?? {}) as { name?: string };

  const adminUserIds = await getAdminUserIds();
  if (adminUserIds.length === 0) return;

  await sendPushToUsers(adminUserIds, {
    title: APP_NAME,
    body: `${where} → ${statusLabel(opts.newStatus)}${
      client.name ? ` (${client.name})` : ""
    }`,
    url: `/stages/${opts.stageId}`,
    tag: `stage-${opts.stageId}`,
  });
}

/**
 * The "3-day photo nag": find every stage whose stage_date is exactly
 * 3 days from today, has zero photos uploaded, and hasn't been nagged
 * about yet. Pings admins via push.
 */
export async function runPhotoReminderCheck(): Promise<{
  found: number;
  sent: number;
}> {
  const supabase = createAdminClient();

  // Pacific-anchored — see src/lib/time.ts. The cron runs at a fixed
  // UTC time (16:00) which is 8/9 AM Pacific, well into "today" PST.
  const targetISO = addDaysISO(todayPacificISO(), 3);

  const { data: stages } = await supabase
    .from("stages")
    .select("id, address, city, stage_date, clients(name)")
    .eq("status", "scheduled")
    .eq("stage_date", targetISO)
    .is("photo_reminder_sent_at", null);

  if (!stages || stages.length === 0) return { found: 0, sent: 0 };

  const stageIds = stages.map((s: any) => s.id);
  // Only real photos count as "has pictures" — a walkthrough video alone
  // doesn't satisfy the photo reminder (matches refresh_stage_first_photo
  // and the dashboard's Need-pictures panel, which are image-only).
  const { data: photoRows } = await supabase
    .from("stage_photos")
    .select("stage_id")
    .eq("media_type", "image")
    .in("stage_id", stageIds);
  const withPhotos = new Set((photoRows ?? []).map((p: any) => p.stage_id));
  const needPhotos = stages.filter((s: any) => !withPhotos.has(s.id));

  if (needPhotos.length === 0) return { found: 0, sent: 0 };

  const adminUserIds = isPushConfigured() ? await getAdminUserIds() : [];

  let totalSent = 0;
  for (const s of needPhotos as any[]) {
    const where = s.city ? `${s.address}, ${s.city}` : s.address;
    const body = `Reminder: ${where} stages in 3 days — no photos uploaded yet.${
      s.clients?.name ? ` Client: ${s.clients.name}.` : ""
    }`;

    if (adminUserIds.length > 0) {
      const { sent } = await sendPushToUsers(adminUserIds, {
        title: `${APP_NAME} — photo reminder`,
        body,
        url: `/stages/${s.id}`,
        tag: `photo-reminder-${s.id}`,
      });
      totalSent += sent;
    }

    await supabase
      .from("stages")
      .update({ photo_reminder_sent_at: new Date().toISOString() })
      .eq("id", s.id);
  }

  return { found: needPhotos.length, sent: totalSent };
}

/**
 * Notify stagers via push when they're newly assigned to a stage or
 * destage. Compares old vs new stager id lists; only the newly-added
 * ids get pinged. Best-effort: failures are logged, never thrown.
 */
export async function notifyStagerAssignment(opts: {
  stageId: string;
  kind: "stage" | "destage";
  oldStagerIds: string[];
  newStagerIds: string[];
}): Promise<void> {
  const added = opts.newStagerIds.filter(
    (id) => !opts.oldStagerIds.includes(id),
  );
  if (added.length === 0 || !isPushConfigured()) return;

  const supabase = createAdminClient();
  const { data: stage } = await supabase
    .from("stages")
    .select("address, city, stage_date, destage_date")
    .eq("id", opts.stageId)
    .single();
  if (!stage) return;

  const when =
    opts.kind === "destage" ? stage.destage_date : stage.stage_date;

  // Crew can only see jobs within the next few days. A job beyond that
  // (or with no date yet) isn't announced now — the link would 404 for
  // them — the daily cron (runCrewAssignmentReleaseCheck) sends it the
  // morning the job enters their window.
  if (!when || when > crewHorizonISO()) return;

  await sendPushToUsers(added, assignmentPush(opts.stageId, opts.kind, stage));
}

function assignmentPush(
  stageId: string,
  kind: "stage" | "destage",
  stage: { address: string; city: string | null; stage_date: string | null; destage_date: string | null },
) {
  const where = stage.city ? `${stage.address}, ${stage.city}` : stage.address;
  const when = kind === "destage" ? stage.destage_date : stage.stage_date;
  const dateLabel = when
    ? new Date(`${when}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "TBD";
  return {
    title: APP_NAME,
    body: `You're on the ${kind} crew for ${where} on ${dateLabel}`,
    url: `/stages/${stageId}`,
    tag: `assign-${stageId}-${kind}`,
  };
}

/**
 * Daily: announce crew assignments the morning a job enters the crew's
 * visibility window. Pairs with the horizon gate in
 * notifyStagerAssignment — jobs assigned further out than
 * CREW_HORIZON_DAYS are held until this fires. Targets jobs dated
 * exactly today + CREW_HORIZON_DAYS, so each job is announced once as
 * it crosses in. A job whose date is pulled inside the window after
 * that day isn't re-announced here (the admin's reassignment, if any,
 * notifies immediately since it's now within the window).
 */
export async function runCrewAssignmentReleaseCheck(): Promise<{
  stages: number;
  destages: number;
  sent: number;
}> {
  if (!isPushConfigured()) return { stages: 0, destages: 0, sent: 0 };
  const supabase = createAdminClient();
  const targetISO = crewHorizonISO();

  const [{ data: staging }, { data: destaging }] = await Promise.all([
    supabase
      .from("stages")
      .select("id, address, city, stage_date, destage_date, assigned_stager_ids")
      .eq("status", "scheduled")
      .eq("stage_date", targetISO),
    supabase
      .from("stages")
      .select("id, address, city, stage_date, destage_date, destage_stager_ids")
      .eq("status", "staged")
      .eq("destage_date", targetISO),
  ]);

  let sent = 0;
  let stages = 0;
  let destages = 0;
  for (const s of (staging ?? []) as any[]) {
    const ids: string[] = Array.isArray(s.assigned_stager_ids) ? s.assigned_stager_ids : [];
    if (ids.length === 0) continue;
    stages++;
    const r = await sendPushToUsers(ids, assignmentPush(s.id, "stage", s));
    sent += r.sent;
  }
  for (const s of (destaging ?? []) as any[]) {
    const ids: string[] = Array.isArray(s.destage_stager_ids) ? s.destage_stager_ids : [];
    if (ids.length === 0) continue;
    destages++;
    const r = await sendPushToUsers(ids, assignmentPush(s.id, "destage", s));
    sent += r.sent;
  }
  return { stages, destages, sent };
}

/**
 * Notify admins via push when a vehicle/trailer issue is reported.
 */
export async function notifyVehicleIssue(opts: {
  vehicleId: string;
  vehicleName: string;
  description: string;
  reportedBy?: string | null;
}): Promise<void> {
  if (!isPushConfigured()) return;
  const adminUserIds = await getAdminUserIds();
  if (adminUserIds.length === 0) return;

  await sendPushToUsers(adminUserIds, {
    title: `${APP_NAME} — vehicle issue`,
    body: `${opts.vehicleName}: ${opts.description}${
      opts.reportedBy ? ` (${opts.reportedBy})` : ""
    }`,
    url: `/maintenance/${opts.vehicleId}`,
    tag: `vehicle-issue-${opts.vehicleId}`,
  });
}

/**
 * Push every admin when the crew reports an arrival issue (no lockbox
 * key / inaccessible / not ready) — a fee invoice is now waiting for
 * approval on the stage page.
 */
export async function notifyArrivalIssue(opts: {
  stageId: string;
  address: string;
  summary: string;
  reportedBy?: string | null;
}): Promise<void> {
  if (!isPushConfigured()) return;
  const adminUserIds = await getAdminUserIds();
  if (adminUserIds.length === 0) return;
  await sendPushToUsers(adminUserIds, {
    title: `${APP_NAME} — arrival issue`,
    body: `${opts.address}: ${opts.summary}${
      opts.reportedBy ? ` (${opts.reportedBy})` : ""
    } — fee invoice awaiting approval`,
    url: `/stages/${opts.stageId}`,
    tag: `arrival-issue-${opts.stageId}`,
  });
}
