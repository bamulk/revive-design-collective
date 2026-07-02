"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { setPasswordAction } from "./actions";

/**
 * Set-password page used by invited employees (first login) and by
 * users completing a password reset.
 *
 * Assumes the auth callback has already exchanged the OTP code for a
 * session — so `supabase.auth.getUser()` returns the right user here.
 * If there's no session, we bounce back to /login.
 */
export default function SetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setEmail(data.user.email ?? null);
      setBootstrapped(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Lightweight strength check — we don't have HaveIBeenPwned (Pro
   * feature), so block the most obvious bad passwords client-side.
   * Returns null if the password is acceptable, or an error string.
   */
  function passwordIssue(p: string): string | null {
    if (p.length < 10) return "Use at least 10 characters.";
    // Require a mix of character classes.
    const hasLower = /[a-z]/.test(p);
    const hasUpper = /[A-Z]/.test(p);
    const hasDigit = /\d/.test(p);
    const classes = [hasLower, hasUpper, hasDigit].filter(Boolean).length;
    if (classes < 2) {
      return "Mix at least two of: lowercase letters, uppercase letters, numbers.";
    }
    // Reject the top common passwords.
    const COMMON = new Set([
      "password",
      "password1",
      "password123",
      "qwerty",
      "qwerty123",
      "12345678",
      "123456789",
      "1234567890",
      "iloveyou",
      "letmein",
      "admin",
      "admin123",
      "welcome",
      "welcome1",
      "abc12345",
    ]);
    if (COMMON.has(p.toLowerCase())) {
      return "That password is on the most-common list. Pick something less guessable.";
    }
    // Reject all-same-character or simple sequences.
    if (/^(.)\1+$/.test(p)) return "Avoid repeating a single character.";
    if (
      "abcdefghijklmnopqrstuvwxyz".includes(p.toLowerCase()) ||
      "0123456789".includes(p)
    ) {
      return "Avoid simple sequences.";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const issue = passwordIssue(pw);
    if (issue) {
      setError(issue);
      return;
    }
    if (pw !== pw2) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    // Run the password update server-side. The browser SDK's
    // updateUser() fails with "Auth session missing!" once the
    // invite's short-lived access token expires — the server-side
    // path uses cookie-bound auth and is more resilient.
    const res = await setPasswordAction(pw);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Hard navigation so the freshly-rotated session cookie is sent
    // on the next request (avoids a stale-session redirect to /login).
    window.location.replace("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-amber-200 rounded-full opacity-20 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-amber-200 rounded-full opacity-20 blur-3xl" />
      </div>
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-7 space-y-5">
        <div className="flex items-center gap-3">
          <Image
            src="/icon.png"
            alt="Revive Design Collective"
            width={48}
            height={48}
            className="w-12 h-12"
            priority
          />
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              Revive Design Collective
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Set your password to finish setup
            </div>
          </div>
        </div>
        {email && (
          <div className="text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 rounded-lg px-3 py-2">
            You&apos;re setting a password for{" "}
            <span className="font-medium">{email}</span>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Hidden username input so iOS Passwords / 1Password / etc.
              know which account to label the saved credential under.
              Spec-required for new-password forms to trigger the
              "Save Password?" prompt reliably. */}
          {email && (
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={email}
              readOnly
              hidden
              aria-hidden="true"
            />
          )}
          <label htmlFor="new-password" className="sr-only">
            New password
          </label>
          <input
            id="new-password"
            name="new-password"
            type="password"
            placeholder="New password"
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={!bootstrapped || loading}
            className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
          <label htmlFor="confirm-password" className="sr-only">
            Confirm password
          </label>
          <input
            id="confirm-password"
            name="confirm-password"
            type="password"
            placeholder="Confirm password"
            autoComplete="new-password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            disabled={!bootstrapped || loading}
            className="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
          {error && (
            <div className="text-sm text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={!bootstrapped || loading}
            className="w-full bg-brand hover:bg-brand-hover disabled:opacity-60 text-white rounded-lg py-2.5 font-medium"
          >
            {loading ? "Saving…" : "Set password & sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
