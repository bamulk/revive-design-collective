import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  // Team sign-in (/login) bounces logged-in users; the portal login is
  // treated as public (see below) so a partial / orphaned session
  // can't get stuck in a /portal → /portal/login → / → /portal loop.
  const isAuthRoute = pathname === "/login" || pathname.startsWith("/login/");
  const isPortalRoute = pathname === "/portal" || pathname.startsWith("/portal/");
  const isPortalLogin =
    pathname === "/portal/login" || pathname.startsWith("/portal/login/");
  // Token-protected client-facing routes that don't require login.
  // The URL itself is the secret (high-entropy token).
  // Also exempt the auth-callback + set-password pages: invite emails
  // land on /auth/callback BEFORE a session cookie exists (the auth
  // tokens are still being exchanged client-side), and /set-password
  // hosts the post-invite onboarding form — both need to render even
  // for "unauthenticated" requests from the middleware's POV.
  const isPublicRoute =
    pathname.startsWith("/e/") ||
    // /x/{token} is the public extension-confirmation page clients land on
    // from the 10-day reminder email. URL contains a high-entropy token.
    pathname.startsWith("/x/") ||
    // /handoff/{token} lets an agent pass a stage to the seller.
    // URL contains a high-entropy token.
    pathname.startsWith("/handoff/") ||
    pathname.startsWith("/api/signatures/webhook") ||
    // Cron routes auth via CRON_SECRET (bearer header). They must
    // skip the session-cookie check or the middleware will redirect
    // them to /login before they run.
    pathname.startsWith("/api/cron/") ||
    // Plaid webhook hits us without a session — verification is by JWT
    // signature against Plaid's public key (see the webhook route).
    pathname.startsWith("/api/plaid/webhook") ||
    pathname.startsWith("/auth/callback") ||
    // /auth/finish is the client-side fragment handler — same trust
    // status as /auth/callback (no session cookie yet).
    pathname.startsWith("/auth/finish") ||
    pathname.startsWith("/set-password") ||
    // Portal sign-in is always reachable, signed-in or not. A
    // client-side redirect inside the page handles the "already
    // signed in" case so the proxy can't tangle role lookups into
    // a redirect loop.
    isPortalLogin;

  if (!user && !isAuthRoute && !isPublicRoute) {
    const url = request.nextUrl.clone();
    // Unauthenticated /portal/* visits go to the client portal sign-in;
    // anything else uses the team sign-in.
    url.pathname = isPortalRoute ? "/portal/login" : "/login";
    return NextResponse.redirect(url);
  }
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    // Send logged-in users to the root; the (app)/portal layouts route
    // them to the right place based on whether they're team or client.
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
