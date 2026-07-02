import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, isEmailConfigured } from "@/lib/email-send";
import { emailButton } from "@/lib/email-button";

/**
 * Send a client a portal sign-in link.
 *
 * Uses an admin-generated **token-hash** magic link (not PKCE), emailed
 * via Resend. This is the key difference from signInWithOtp + Supabase
 * SMTP: PKCE stores a code_verifier cookie and only works if the link is
 * opened in the SAME browser that requested it — so links opened from an
 * email app's in-app browser (or admin-sent links) fail with "PKCE code
 * verifier not found." A token_hash is verified server-side at
 * /auth/callback with verifyOtp and needs no verifier, so it works on
 * any device/browser.
 *
 * The project has signups disabled, so the auth user is pre-created via
 * the admin API (existing-user conflicts are expected and ignored).
 */
export async function sendPortalMagicLink(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isEmailConfigured()) {
    return { ok: false, error: "Email isn't configured on the server." };
  }
  const admin = createAdminClient();
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://app.revivedesigncollective.com";

  // Ensure the auth user exists (signups are disabled project-wide).
  try {
    const { error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createErr && !/already|registered|exists/i.test(createErr.message)) {
      console.error("[portal-link createUser]", createErr);
      return { ok: false, error: "Couldn't set up the account." };
    }
  } catch (e) {
    console.error("[portal-link createUser]", e);
    return { ok: false, error: "Couldn't set up the account." };
  }

  // Generate a magic link and pull its token_hash.
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("[portal-link generateLink]", error);
    return { ok: false, error: "Couldn't create the sign-in link." };
  }

  const verifyUrl = `${siteUrl}/auth/callback?token_hash=${encodeURIComponent(
    tokenHash,
  )}&type=magiclink`;

  const subject = "Your Revive Design Collective portal link";
  const text =
    `Tap to sign in to your Revive Design Collective portal and view your ` +
    `stages, dates, and payment status:\n\n${verifyUrl}\n\n` +
    `This signs you in directly — no password. If you didn't request ` +
    `it, you can ignore this email.`;
  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; line-height:1.5; color:#0f172a; max-width:560px; margin:0 auto; padding:24px;">
  <p>Tap below to sign in to your <strong>Revive Design Collective</strong> portal and view your stages, dates, and payment status.</p>
  ${emailButton({ href: verifyUrl, label: "Open my portal" })}
  <p style="font-size:13px; color:#64748b;">This signs you in directly — no password needed. If you didn't request this, you can ignore the email.</p>
</body></html>`;

  try {
    await sendEmail({ to: email, subject, text, html });
    return { ok: true };
  } catch (e) {
    console.error("[portal-link sendEmail]", e);
    return { ok: false, error: "Couldn't send the link. Try again shortly." };
  }
}
