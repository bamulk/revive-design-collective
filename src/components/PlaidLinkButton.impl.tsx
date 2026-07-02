"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Loader2, Link2 } from "lucide-react";
import {
  createPlaidLinkTokenAction,
  exchangePlaidPublicTokenAction,
} from "@/app/(app)/finance/plaid-actions";

/**
 * "Connect a bank" button. Fetches a Plaid link_token on mount so the
 * Plaid Link modal can open instantly when the admin clicks. On
 * success, exchanges the public_token for an access_token and fires
 * an initial transactions sync — then refreshes the page so the new
 * expenses + connected-item card show up.
 */
export default function PlaidLinkButton() {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Mint the link token up-front so the modal opens without a delay.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await createPlaidLinkTokenAction();
      if (cancelled) return;
      if (!res.ok) setError(res.error);
      else setLinkToken(res.link_token);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSuccess = useCallback(async (publicToken: string) => {
    setBusy(true);
    setError(null);
    const res = await exchangePlaidPublicTokenAction(publicToken);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Hard-refresh so the server components on /finance rebuild with
    // the new connected-item row + freshly-synced expenses.
    window.location.reload();
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: (err) => {
      if (err) setError(err.display_message || err.error_message || err.error_code);
    },
  });

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => open()}
        disabled={!ready || !linkToken || busy}
        className="inline-flex items-center gap-1.5 bg-slate-900 text-white rounded-lg px-4 py-2.5 text-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy || !linkToken ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Link2 size={14} />
        )}
        {busy ? "Importing transactions…" : "Connect a bank"}
      </button>
      {error && (
        <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
}
