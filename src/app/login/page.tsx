"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { KeyRound, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";

/**
 * Sign-in page. Public sign-up is intentionally disabled — accounts
 * are admin-created only via the Team page (employee invites). Anyone
 * who needs access needs an admin to invite them.
 */
export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Passkeys render only after a client-side capability check so the
  // server HTML never disagrees with the first paint.
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  useEffect(() => {
    setPasskeySupported(
      typeof window !== "undefined" && !!window.PublicKeyCredential,
    );
  }, []);

  async function handlePasskey() {
    setError(null);
    setPasskeyLoading(true);
    try {
      const { error: pkError } = await supabase.auth.signInWithPasskey();
      if (pkError) {
        // A cancelled Face ID prompt isn't an error worth shouting about.
        if (!/NotAllowed|cancel|abort|timed? ?out/i.test(pkError.message)) {
          setError(
            /passkey_disabled/.test(
              `${(pkError as { code?: string }).code ?? ""} ${pkError.message}`,
            )
              ? "Passkey sign-in isn't enabled yet — use your password."
              : pkError.message,
          );
        }
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setPasskeyLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-amber-200 rounded-full opacity-20 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-amber-200 rounded-full opacity-20 blur-3xl" />
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white dark:bg-slate-900/90 backdrop-blur-sm p-8 rounded-2xl shadow-xl shadow-slate-900/5 border border-slate-200 dark:border-slate-700/70 space-y-5"
      >
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
              Revive Design Collective
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400">Welcome back</p>
          </div>
        </div>

        <div className="space-y-3">
          {/* Apple Passwords / 1Password / Chrome autofill all key off
              of the combination of id + name + autocomplete on the
              <input>. Without name attributes, iOS won't offer to
              save the password after sign-in, and there's nothing for
              it to fill on the next visit. The <label htmlFor> also
              helps password managers identify the field. */}
          <label htmlFor="email" className="sr-only">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            required
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3.5 py-3 text-base text-slate-900 dark:text-slate-100"
          />
          <label htmlFor="password" className="sr-only">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3.5 py-3 text-base text-slate-900 dark:text-slate-100"
          />
        </div>

        {error && (
          <p className="text-red-600 text-sm bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <Button disabled={loading} className="w-full">
          {loading ? "…" : "Sign in"}
        </Button>

        {passkeySupported && (
          <>
            <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              or
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>
            <button
              type="button"
              onClick={() => void handlePasskey()}
              disabled={passkeyLoading || loading}
              className="w-full inline-flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-600 rounded-lg px-3.5 py-3 text-base font-medium text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
            >
              {passkeyLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <KeyRound size={16} />
              )}
              Sign in with a passkey
            </button>
          </>
        )}

        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Access is by invitation. Need an account? Ask an admin to invite
          you.
        </p>
      </form>
    </div>
  );
}
