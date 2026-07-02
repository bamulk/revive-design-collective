"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-admin";
import { requireTeamMember } from "@/lib/permissions";
import { notifyVehicleIssue } from "@/lib/notify";

function revalidate(vehicleId: string) {
  revalidatePath(`/maintenance/${vehicleId}`);
  revalidatePath("/maintenance");
}

/** Update a vehicle's current odometer. Any team member. */
export async function updateMileageAction(
  vehicleId: string,
  formData: FormData,
) {
  await requireTeamMember();
  const supabase = await createClient();
  const raw = String(formData.get("current_mileage") ?? "").trim();
  const miles = raw ? parseInt(raw, 10) : NaN;
  const { error } = await supabase
    .from("vehicles")
    .update({ current_mileage: Number.isFinite(miles) ? miles : null })
    .eq("id", vehicleId);
  if (error) throw new Error(error.message);
  revalidate(vehicleId);
}

/** Rename a vehicle / edit its notes. Admin only. */
export async function updateVehicleAction(
  vehicleId: string,
  formData: FormData,
) {
  await requireAdmin();
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!name) return;
  const { error } = await supabase
    .from("vehicles")
    .update({ name, notes })
    .eq("id", vehicleId);
  if (error) throw new Error(error.message);
  revalidate(vehicleId);
}

/** Log an oil change or a service. Any team member (stagers + lead stagers
 * are responsible for vehicle maintenance). */
export async function logServiceAction(vehicleId: string, formData: FormData) {
  await requireTeamMember();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const kind =
    String(formData.get("kind") ?? "") === "oil_change"
      ? "oil_change"
      : "service";
  const performed_on = String(formData.get("performed_on") ?? "").trim() || null;
  const mileageRaw = String(formData.get("mileage") ?? "").trim();
  const mileage = mileageRaw ? parseInt(mileageRaw, 10) : null;
  const costRaw = String(formData.get("cost") ?? "").trim();
  const cost = costRaw ? parseFloat(costRaw) : null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const { error } = await supabase.from("vehicle_service_logs").insert({
    vehicle_id: vehicleId,
    kind,
    ...(performed_on ? { performed_on } : {}), // else DB default = today
    mileage: Number.isFinite(mileage as number) ? mileage : null,
    cost: Number.isFinite(cost as number) ? cost : null,
    notes,
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  // Keep the odometer in sync if this service recorded a higher reading.
  if (mileage != null && Number.isFinite(mileage)) {
    await supabase
      .from("vehicles")
      .update({ current_mileage: mileage })
      .eq("id", vehicleId)
      .or(`current_mileage.is.null,current_mileage.lt.${mileage}`);
  }
  revalidate(vehicleId);
}

/** Delete a service log entry. Admin only. */
export async function deleteServiceLogAction(logId: string, vehicleId: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicle_service_logs")
    .delete()
    .eq("id", logId);
  if (error) throw new Error(error.message);
  revalidate(vehicleId);
}

/** Report an issue against a vehicle. Any team member; pings admins. */
export async function reportIssueAction(vehicleId: string, formData: FormData) {
  const { userId } = await requireTeamMember();
  const supabase = await createClient();
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return;

  const { error } = await supabase.from("vehicle_issues").insert({
    vehicle_id: vehicleId,
    description,
    reported_by: userId,
  });
  if (error) throw new Error(error.message);

  // Notify admins after the response so the form returns instantly.
  after(async () => {
    try {
      const [{ data: v }, { data: me }] = await Promise.all([
        supabase.from("vehicles").select("name").eq("id", vehicleId).single(),
        supabase
          .from("profiles")
          .select("full_name")
          .eq("id", userId)
          .maybeSingle(),
      ]);
      await notifyVehicleIssue({
        vehicleId,
        vehicleName: v?.name ?? "Vehicle",
        description,
        reportedBy: me?.full_name ?? null,
      });
    } catch (e) {
      console.error("[vehicle issue notify]", e);
    }
  });

  revalidate(vehicleId);
}

/** Mark an issue resolved. Any team member. */
export async function resolveIssueAction(issueId: string, vehicleId: string) {
  await requireTeamMember();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("vehicle_issues")
    .update({
      status: "resolved",
      resolved_by: user?.id ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", issueId);
  if (error) throw new Error(error.message);
  revalidate(vehicleId);
}

/** Re-open a resolved issue. Any team member. */
export async function reopenIssueAction(issueId: string, vehicleId: string) {
  await requireTeamMember();
  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicle_issues")
    .update({ status: "open", resolved_by: null, resolved_at: null })
    .eq("id", issueId);
  if (error) throw new Error(error.message);
  revalidate(vehicleId);
}
