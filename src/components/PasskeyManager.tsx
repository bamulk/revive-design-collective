"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatMDY } from "@/lib/time";

type PasskeyRow = {
  id: string;
  friendly_name?: string | null;
  created_at: string;
  last_used_at?: string | null;
};

/** Friendly copy for the errors people will actually hit. */
function friendlyError(e: { code?: string; message?: string } | null): string {
  const code = e?.code ?? "";
  const msg = e?.message ?? "";
  if (code === "passkey_disabled" || /passkey_disabled/.test(msg)) {
    return "Passkeys aren't enabled on the server yet — an admin needs to turn them on in Supabase (Authentication → Passkeys).";
  }
  if (code === "webauthn_credential_exists") {
    return "This device's passkey is already registered on your account.";
  }
  if (/NotAllowed|cancel|abort|timed? ?out/i.test(msg)) {
    return "Cancelled — no passkey was added.";
  }
  return msg || "Something went wrong.";
}

/**
 * Passkey management card for /account: list, add, and remove the
 * signed-in team member's passkeys. Passkeys sync via iCloud Keychain /
 * Google Password Manager, so one registration covers the person's
 * other devices too. Registration requires the Supabase project's
 * passkey toggle to be on (Authentication → Passkeys).
 */
export default function PasskeyManager() {
  const supabase = createClient();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [rows, setRows] = useState<PasskeyRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" && !!window.PublicKeyCredential,
    );
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const { data, error: listErr } = await supabase.auth.passkey.list();
    if (listErr) {
      setError(friendlyError(listErr));
      setRows([]);
      return;
    }
    setRows((data as PasskeyRow[] | null) ?? []);
  }

  async function addPasskey() {
    setError(null);
    setAdded(false);
    setBusy(true);
    try {
      const { error: regErr } = await supabase.auth.registerPasskey();
      if (regErr) {
        setError(friendlyError(regErr));
      } else {
        setAdded(true);
        await refresh();
      }
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    setBusy(true);
    try {
      const { error: delErr } = await supabase.auth.passkey.delete({
        passkeyId: id,
      });
      if (delErr) setError(friendlyError(delErr));
      else await refresh();
    } finally {
      setBusy(false);
      setConfirmingId(null);
    }
  }

  return (
    <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium inline-flex items-center gap-2">
          <KeyRound size={16} /> Passkeys
        </h2>
        {supported && (
          <button
            type="button"
            onClick={() => void addPasskey()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-lg px-3 py-1.5 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Plus size={12} />
            )}
            Add a passkey
          </button>
        )}
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-400">
        Sign in with Face ID / Touch ID instead of your password. A passkey
        added here syncs through iCloud Keychain or Google Password Manager,
        so it works on your other devices too.
      </p>

      {supported === false && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          This browser doesn&rsquo;t support passkeys.
        </p>
      )}
      {added && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          Passkey added — you can use it on the sign-in page from now on.
        </p>
      )}
      {error && (
        <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {rows == null ? (
        <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">
          No passkeys yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <li
              key={r.id}
              className="py-2.5 flex flex-wrap items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  {r.friendly_name || "Passkey"}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  Added {formatMDY(r.created_at)}
                  {r.last_used_at
                    ? ` · last used ${formatMDY(r.last_used_at)}`
                    : ""}
                </div>
              </div>
              {confirmingId === r.id ? (
                <span className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void remove(r.id)}
                    disabled={busy}
                    className="text-xs font-semibold text-white bg-rose-700 rounded-lg px-2.5 py-1 disabled:opacity-60"
                  >
                    Confirm remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    disabled={busy}
                    className="text-xs text-slate-600 dark:text-slate-400 hover:underline"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingId(r.id)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-xs text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60 rounded-lg px-2.5 py-1 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-60"
                >
                  <Trash2 size={11} /> Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
