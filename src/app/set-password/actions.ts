"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Server-side password setter. The /set-password page used to call
 * `supabase.auth.updateUser({ password })` from the browser client,
 * which fails with "Auth session missing!" once the invite's short-
 * lived access token expires (the SDK then tries to refresh and the
 * refresh_token is also single-use). Running the update server-side
 * keeps things working as long as the session cookie is still valid.
 *
 * On success the caller refreshes / navigates — there's no redirect
 * here so we don't trip Next's NEXT_REDIRECT control-flow error.
 */
export async function setPasswordAction(
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof password !== "string" || password.length < 8) {
    return { ok: false, error: "Password is too short." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      error: "Your invite link has expired. Ask the admin to resend it.",
    };
  }
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
