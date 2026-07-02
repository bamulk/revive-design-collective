import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Auth callback (PKCE) for magic-link sign-in.
 *
 * Supabase's server-side `signInWithOtp` stores the PKCE code_verifier
 * in an **httpOnly** cookie. The browser can't read httpOnly cookies,
 * so the legacy client-side callback would fail with "code verifier
 * not found in storage". The fix is to do the exchange server-side,
 * where the cookie IS readable.
 *
 * For non-code requests (the legacy implicit flow with tokens in the
 * URL fragment — mostly the team invite email) we forward to
 * /auth/finish, which is a client component that processes fragments.
 * Per RFC 7231, the browser preserves the original fragment across the
 * 307 redirect so the finish page still sees #access_token=…
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const errorDescription =
    searchParams.get("error_description") || searchParams.get("error");

  if (errorDescription) {
    return NextResponse.redirect(
      `${origin}/auth/finish?error=${encodeURIComponent(errorDescription)}`,
    );
  }

  // Token-hash flow (admin-generated magic links). Verified server-side
  // with no PKCE code_verifier, so it works in ANY browser/device — the
  // fix for "PKCE code verifier not found" when a link is opened from an
  // email app's in-app browser.
  if (tokenHash) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: (type as any) || "magiclink",
      token_hash: tokenHash,
    });
    if (error) {
      return NextResponse.redirect(
        `${origin}/auth/finish?error=${encodeURIComponent(error.message)}`,
      );
    }
    const dest =
      type === "invite" || type === "recovery" ? "/set-password" : "/";
    return NextResponse.redirect(`${origin}${dest}`);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        `${origin}/auth/finish?error=${encodeURIComponent(error.message)}`,
      );
    }
    // Invite/recovery flows land on the password-set form. Everything
    // else goes to the root; the (app)/portal layouts route by role.
    const dest =
      type === "invite" || type === "recovery" ? "/set-password" : "/";
    return NextResponse.redirect(`${origin}${dest}`);
  }

  // No code param — implicit/fragment flow. Forward to the client-side
  // finisher; the browser preserves the URL fragment across the redirect.
  return NextResponse.redirect(`${origin}/auth/finish${request.nextUrl.search}`);
}
