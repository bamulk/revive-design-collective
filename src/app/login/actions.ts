"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, isEmailConfigured } from "@/lib/email-send";
import { emailButton } from "@/lib/email-button";

/**
 * Public "forgot password" sender for the login page.
 *
 * Uses an admin-generated token-hash recovery link emailed via Resend —
 * the same pattern as portal magic links — because PKCE reset links
 * only work in the browser that requested them, and these get opened
 * in email-app webviews. The link verifies at /auth/callback
 * (verifyOtp) and lands on /set-password.
 *
 * Always resolves ok so the response never leaks whether an account
 * exists. Only emails accounts that have a team profile — clients use
 * portal magic links, not passwords.
 */
export async function sendPasswordResetAction(
  rawEmail: string,
): Promise<{ ok: true }> {
  const email = String(rawEmail || "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@") || !isEmailConfigured()) {
    return { ok: true };
  }
  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, full_name")
      .ilike("email", email)
      .maybeSingle();
    if (!profile) return { ok: true };

    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL || "https://app.stonehomestaging.com"
    ).replace(/\/$/, "");
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) {
      console.error("[password-reset] generateLink failed:", error);
      return { ok: true };
    }
    const verifyUrl = `${baseUrl}/auth/callback?token_hash=${encodeURIComponent(
      tokenHash,
    )}&type=recovery`;

    const firstName = (profile.full_name || "there").split(" ")[0] || "there";
    const subject = "Reset your Stone Home Staging password";
    const text = `Hi ${firstName},

Someone (hopefully you) asked to reset your Stone Home Staging password. Click the link below to choose a new one:
${verifyUrl}

If you didn't request this, you can safely ignore this email — your password is unchanged.

— Stone Home Staging`;
    const html = `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height:1.5; color:#0f172a; max-width:560px; margin:0 auto; padding:24px;">
  <p>Hi ${firstName},</p>
  <p>Someone (hopefully you) asked to reset your <strong>Stone Home Staging</strong> password. Click the button below to choose a new one:</p>
  ${emailButton({ href: verifyUrl, label: "Choose a new password" })}
  <p style="font-size:13px; color:#64748b;">If the button doesn't work, copy and paste this link:<br/><span style="word-break:break-all;">${verifyUrl}</span></p>
  <p style="font-size:13px; color:#64748b;">If you didn't request this, ignore this email — your password is unchanged.</p>
  <hr style="border:none; border-top:1px solid #e2e8f0; margin:24px 0;" />
  <p style="font-size:12px; color:#94a3b8;">Stone Home Staging</p>
</body></html>`;

    await sendEmail({ to: email, subject, text, html });
  } catch (e) {
    console.error("[password-reset]", e);
  }
  return { ok: true };
}
