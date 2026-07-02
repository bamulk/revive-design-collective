"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, isEmailConfigured } from "@/lib/email-send";
import { emailButton } from "@/lib/email-button";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") throw new Error("Admin only");
  return supabase;
}

export async function inviteEmployeeAction(formData: FormData) {
  await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") || "").trim();
  const roleRaw = (formData.get("role") as string) || "stager";
  const role = ["admin", "stager", "lead_stager"].includes(roleRaw)
    ? roleRaw
    : "stager";
  if (!email) throw new Error("Email required");
  if (!isEmailConfigured()) {
    throw new Error(
      "Email isn't configured — set RESEND_API_KEY and EMAIL_FROM to invite employees.",
    );
  }

  const admin = createAdminClient();

  // Generate an invite link WITHOUT triggering Supabase's built-in email.
  // The user clicks this link, sets a password, and lands in the app.
  // We then deliver the same link via Resend so the email comes from
  // our verified domain instead of Supabase's default sender.
  //
  // redirectTo must point at our /auth/callback route. Supabase appends
  // ?code=... &type=invite; the callback exchanges the code for a
  // session cookie and sends the user to /set-password.
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL isn't set — needed to build the invite redirect URL.",
    );
  }
  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { full_name: fullName },
      redirectTo: `${baseUrl}/auth/callback`,
    },
  });
  if (error) throw new Error(error.message);

  const userId = data.user?.id;
  const inviteLink = data.properties?.action_link;
  if (!userId || !inviteLink) {
    throw new Error("Failed to create invite link");
  }

  // Stamp the new profile with role/full_name now so they have the
  // right access the moment they accept the invite.
  await admin
    .from("profiles")
    .update({ full_name: fullName, role })
    .eq("id", userId);

  // Send the invite via Resend.
  const firstName = fullName.split(" ")[0] || "there";
  const subject = "You've been invited to Revive Design Collective";
  const text = `Hi ${firstName},

You've been added to the Revive Design Collective app as ${role === "admin" ? "an admin" : role === "lead_stager" ? "a lead stager" : "a stager"}.

Click the link below to set your password and sign in:
${inviteLink}

If you didn't expect this email, you can safely ignore it.

— Revive Design Collective`;
  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height:1.5; color:#0f172a; max-width:560px; margin:0 auto; padding:24px;">
  <p>Hi ${firstName},</p>
  <p>You've been added to the <strong>Revive Design Collective</strong> app as ${role === "admin" ? "an admin" : role === "lead_stager" ? "a lead stager" : "a stager"}.</p>
  <p>Click the button below to set your password and sign in:</p>
  ${emailButton({ href: inviteLink, label: "Accept invitation" })}
  <p style="font-size:13px; color:#64748b;">If the button doesn't work, copy and paste this link:<br/><span style="word-break:break-all;">${inviteLink}</span></p>
  <p style="font-size:13px; color:#64748b;">If you didn't expect this email, you can safely ignore it.</p>
  <hr style="border:none; border-top:1px solid #e2e8f0; margin:24px 0;" />
  <p style="font-size:12px; color:#94a3b8;">Revive Design Collective</p>
</body></html>`;

  try {
    await sendEmail({ to: email, subject, text, html });
  } catch (err: any) {
    // If sending fails, undo the user creation so admin can retry
    // with a corrected email address instead of being stuck with a
    // half-invited account.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(`Failed to send invite email: ${err?.message || err}`);
  }

  revalidatePath("/employees");
}

export async function updateEmployeeRoleAction(id: string, formData: FormData) {
  await requireAdmin();
  const roleRaw = String(formData.get("role") || "stager");
  const role = ["admin", "stager", "lead_stager"].includes(roleRaw)
    ? roleRaw
    : "stager";
  const full_name = String(formData.get("full_name") || "");
  // Optional fields — only update if the form actually included them.
  const phone = formData.has("phone")
    ? String(formData.get("phone") || "").trim() || null
    : undefined;
  const sms_enabled = formData.has("sms_notifications_enabled")
    ? formData.get("sms_notifications_enabled") === "on"
    : undefined;
  const update: Record<string, unknown> = { role, full_name };
  if (phone !== undefined) update.phone = phone;
  if (sms_enabled !== undefined) update.sms_notifications_enabled = sms_enabled;
  const admin = createAdminClient();
  const { error } = await admin.from("profiles").update(update).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/employees");
}

export async function deleteEmployeeAction(id: string) {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) throw new Error(error.message);
  revalidatePath("/employees");
}

/**
 * Resend an invite to a profile whose owner hasn't accepted yet.
 * Generates a fresh action_link via Supabase and delivers it through
 * Resend so the email comes from our verified domain.
 */
export async function resendInviteAction(id: string) {
  await requireAdmin();
  if (!isEmailConfigured()) {
    throw new Error(
      "Email isn't configured — set RESEND_API_KEY and EMAIL_FROM to send invites.",
    );
  }
  const admin = createAdminClient();
  // Look up the email + name on the profile so we can use them in
  // the email body.
  const { data: profile } = await admin
    .from("profiles")
    .select("email, full_name, role")
    .eq("id", id)
    .single();
  if (!profile?.email) throw new Error("Could not find the user's email");

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL isn't set — needed for invite redirect");
  }
  // generateLink with type=invite works even for users that already
  // exist — Supabase just creates a new one-time link tied to their
  // existing account.
  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email: profile.email,
    options: {
      data: { full_name: profile.full_name ?? "" },
      redirectTo: `${baseUrl}/auth/callback`,
    },
  });
  if (error) throw new Error(error.message);
  const inviteLink = data.properties?.action_link;
  if (!inviteLink) throw new Error("Failed to generate invite link");

  const firstName = (profile.full_name || "there").split(" ")[0];
  const subject = "Reminder: your Revive Design Collective invitation";
  const text = `Hi ${firstName},

Your invitation to the Revive Design Collective app is waiting. Click the link below to set your password and sign in:
${inviteLink}

If you didn't expect this email, you can safely ignore it.

— Revive Design Collective`;
  const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height:1.5; color:#0f172a; max-width:560px; margin:0 auto; padding:24px;">
  <p>Hi ${firstName},</p>
  <p>Your invitation to the <strong>Revive Design Collective</strong> app is still waiting. Click the button below to set your password and sign in:</p>
  ${emailButton({ href: inviteLink, label: "Accept invitation" })}
  <p style="font-size:13px; color:#64748b;">If the button doesn't work, copy and paste this link:<br/><span style="word-break:break-all;">${inviteLink}</span></p>
  <hr style="border:none; border-top:1px solid #e2e8f0; margin:24px 0;" />
  <p style="font-size:12px; color:#94a3b8;">Revive Design Collective</p>
</body></html>`;

  await sendEmail({ to: profile.email, subject, text, html });
  revalidatePath("/employees");
}
