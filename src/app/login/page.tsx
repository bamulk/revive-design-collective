"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
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

        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Access is by invitation. Need an account? Ask an admin to invite
          you.
        </p>
      </form>
    </div>
  );
}
