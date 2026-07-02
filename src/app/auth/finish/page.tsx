"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Wrap the inner component in Suspense — useSearchParams requires it
// for the build-time prerender pass not to error out.
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackShell loading />}>
      <AuthCallbackInner />
    </Suspense>
  );
}

/**
 * Auth fragment handler. The server-side route at /auth/callback
 * handles the PKCE flow (?code=…) and only forwards us non-code
 * requests, which is the legacy implicit flow with tokens in the URL
 * fragment (mostly the team invite email).
 *
 * Fragments aren't sent to the server, so the work happens in the
 * browser: extract #access_token / #refresh_token, call setSession,
 * then forward to /set-password for invite/recovery or / otherwise.
 */
function AuthCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        // Determine the flow type. Supabase sends it either in the query
        // string (PKCE) or in the URL fragment (implicit). We peek at both.
        const fragment = new URLSearchParams(
          typeof window !== "undefined"
            ? window.location.hash.replace(/^#/, "")
            : "",
        );
        const flowType =
          params.get("type") ?? fragment.get("type") ?? null;

        // Surface explicit error params first so we don't get a generic
        // "couldn't establish session" when Supabase already told us why.
        const fragErr =
          fragment.get("error_description") ||
          fragment.get("error") ||
          params.get("error_description") ||
          params.get("error");
        if (fragErr) {
          setError(decodeURIComponent(fragErr));
          return;
        }

        // --- PKCE flow: ?code=... in the query string ---
        const code = params.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw new Error(error.message);
        }

        // --- Implicit flow: tokens in the URL fragment ---
        // @supabase/ssr's createBrowserClient doesn't auto-process URL
        // fragments, so we have to call setSession explicitly. Don't
        // await without a timeout — setSession can block on a token
        // refresh request that never completes on flaky networks.
        const access_token = fragment.get("access_token");
        const refresh_token = fragment.get("refresh_token");
        if (access_token && refresh_token) {
          // Promise.race wins if setSession hangs (rare but possible
          // if the supabase auth API is slow or unreachable).
          const result = await Promise.race([
            supabase.auth.setSession({ access_token, refresh_token }),
            new Promise<{ error: { message: string } }>((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    error: { message: "Network timeout — try again." },
                  }),
                10_000,
              ),
            ),
          ]);
          if ((result as any)?.error) {
            throw new Error((result as any).error.message);
          }
        } else if (!code) {
          // Neither code nor tokens — link is malformed/expired.
          throw new Error("Invite link is missing its auth data. Ask for a new invite.");
        }

        // Clean the hash from the URL so tokens don't sit in history.
        if (window.location.hash) {
          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search,
          );
        }

        if (cancelled) return;

        // Use window.location for a hard navigation so the proxy sees
        // the freshly-written auth cookies on the next request. Router
        // navigations can race with cookie writes on some browsers.
        const dest =
          flowType === "invite" || flowType === "recovery"
            ? "/set-password"
            : "/";
        window.location.replace(dest);
      } catch (e: any) {
        if (!cancelled) {
          console.error("[auth/callback]", e);
          setError(e?.message || "Couldn't sign you in.");
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <CallbackShell loading={!error} error={error} />;
}

function CallbackShell({
  loading,
  error,
}: {
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-7 text-center space-y-4">
        <Image
          src="/icon.png"
          alt="Revive Design Collective"
          width={48}
          height={48}
          className="w-12 h-12 mx-auto"
          priority
        />
        {error ? (
          <>
            <div className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
              {error}
            </div>
            <a
              href="/login"
              className="block text-sm text-brand hover:underline"
            >
              Back to sign in →
            </a>
          </>
        ) : (
          <>
            <Loader2 className="w-6 h-6 text-brand animate-spin mx-auto" />
            <p className="text-sm text-slate-700 dark:text-slate-300">Signing you in…</p>
          </>
        )}
      </div>
    </div>
  );
}
