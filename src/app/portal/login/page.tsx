"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { requestPortalLinkAction } from "../actions";

/**
 * Client portal sign-in. Magic-link only — clients enter their email
 * and get a one-click link. No passwords to manage. The server action
 * silently no-ops for emails that aren't on file so the form can't be
 * used to enumerate which addresses are clients.
 */
export default function PortalLoginPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Track an existing session so we don't show the sign-in form to
  // someone who's already signed in. Three states:
  //   - null   → checking
  //   - false  → not signed in (show form)
  //   - string → signed-in user's email (show "go to portal" CTA)
  const [signedInAs, setSignedInAs] = useState<string | null | false>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      setSignedInAs(data.user?.email ?? false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Hard reload so the proxy + layouts see no session on the next
    // request — avoids the historical "cookie still set on redirect"
    // race that caused the redirect loop.
    window.location.replace("/portal/login");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const res = await requestPortalLinkAction(null, fd);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-amber-200 rounded-full opacity-20 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-amber-200 rounded-full opacity-20 blur-3xl" />
      </div>

      <div className="w-full max-w-sm bg-white dark:bg-slate-900/90 backdrop-blur-sm p-8 rounded-2xl shadow-xl shadow-slate-900/5 border border-slate-200 dark:border-slate-700/70 space-y-5">
        <div className="flex items-center gap-3">
          <Image
            src="/icon.png"
            alt="Revive Design Collective"
            width={44}
            height={44}
            className="w-11 h-11 object-contain"
            priority
          />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Client portal
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Sign in with your email
            </p>
          </div>
        </div>

        {signedInAs === null ? (
          <div className="flex items-center justify-center py-6 text-slate-500 dark:text-slate-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : signedInAs ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              You&rsquo;re already signed in as{" "}
              <span className="font-medium">{signedInAs}</span>. To use the
              portal under a different email, sign out and request a new link.
            </p>
            <div className="flex flex-col gap-2">
              <a
                href="/portal"
                className="block w-full text-center bg-brand text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-brand-hover"
              >
                Open my portal
              </a>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-sm text-slate-600 dark:text-slate-400 hover:text-rose-700"
              >
                Sign out and use a different email
              </button>
            </div>
          </div>
        ) : sent ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-900/60 rounded-lg px-3 py-2.5">
              <Mail size={16} className="mt-0.5 shrink-0" />
              <span>
                If <span className="font-medium">{email}</span> is on file,
                we&rsquo;ve emailed you a sign-in link. Open the link on this
                device to continue.
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
              className="text-xs text-brand hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3.5 py-3 text-base text-slate-900 dark:text-slate-100"
            />

            {error && (
              <p className="text-red-600 text-sm bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <Button disabled={pending || !email} className="w-full">
              {pending ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Sending…
                </span>
              ) : (
                "Email me a sign-in link"
              )}
            </Button>

            <p className="text-center text-xs text-slate-500 dark:text-slate-400">
              Portal access is by invitation. If your stages don&rsquo;t
              appear, contact Revive Design Collective.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
