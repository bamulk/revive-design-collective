"use client";

import { useState } from "react";
import ClientSelect from "./ClientSelect";

type ClientOption = { id: string; name: string; email?: string | null };

/**
 * Who the invoice is billed to. Two modes:
 *   - client: pick (or inline-create) a client via <ClientSelect />;
 *     the server snapshots their name/email/address. An optional email
 *     override lets a split invoice go to a seller instead.
 *   - other: a one-off name/email/address with no client row — e.g. a
 *     furniture buyer you'll never see again.
 * Posts `bill_mode` plus the fields for whichever mode is active.
 */
export default function InvoiceBillToFields({
  clients,
  defaultMode = "client",
  defaultClientId,
  defaultName = "",
  defaultEmail = "",
  defaultAddress = "",
  lockClient = false,
}: {
  clients: ClientOption[];
  defaultMode?: "client" | "other";
  defaultClientId?: string | null;
  defaultName?: string;
  defaultEmail?: string;
  defaultAddress?: string;
  /** When the invoice is linked to a stage, the client is fixed. */
  lockClient?: boolean;
}) {
  const [mode, setMode] = useState<"client" | "other">(defaultMode);
  const input =
    "mt-1 w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2.5 text-base bg-white dark:bg-slate-900";

  return (
    <div className="space-y-3">
      <input type="hidden" name="bill_mode" value={mode} />

      {!lockClient && (
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 text-sm">
          <button
            type="button"
            onClick={() => setMode("client")}
            className={`px-3 py-1.5 rounded-md ${
              mode === "client"
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            Bill a client
          </button>
          <button
            type="button"
            onClick={() => setMode("other")}
            className={`px-3 py-1.5 rounded-md ${
              mode === "other"
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            Someone else
          </button>
        </div>
      )}

      {mode === "client" ? (
        <>
          {lockClient && defaultClientId ? (
            <>
              <input type="hidden" name="client_id" value={defaultClientId} />
              <div className="text-sm">
                <span className="font-medium text-slate-900 dark:text-slate-100">Client</span>
                <div className="mt-1 border rounded px-3 py-2.5 text-base bg-slate-50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300">
                  {clients.find((c) => c.id === defaultClientId)?.name ?? "Client"}
                </div>
              </div>
            </>
          ) : (
            <ClientSelect clients={clients} defaultClientId={defaultClientId ?? undefined} />
          )}
          <label className="block text-sm">
            Send to a different email (optional)
            <input
              name="bill_to_email"
              type="email"
              defaultValue={defaultEmail}
              autoComplete="off"
              placeholder="Leave blank to use the client's email"
              className={input}
            />
            <span className="block mt-1 text-xs text-slate-500 dark:text-slate-400">
              Useful when a seller is paying part of a stage. The client
              stays on the record.
            </span>
          </label>
        </>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm">
            Name *
            <input
              name="bill_to_name"
              required
              defaultValue={defaultName}
              autoComplete="off"
              placeholder="Jane Buyer"
              className={input}
            />
          </label>
          <label className="block text-sm">
            Email
            <input
              name="bill_to_email"
              type="email"
              defaultValue={defaultEmail}
              autoComplete="off"
              placeholder="jane@example.com"
              className={input}
            />
            <span className="block mt-1 text-xs text-slate-500 dark:text-slate-400">
              Needed to email the invoice; you can still print it without one.
            </span>
          </label>
          <label className="block text-sm">
            Address
            <textarea
              name="bill_to_address"
              rows={2}
              defaultValue={defaultAddress}
              placeholder={"123 Main St\nSacramento, CA 95819"}
              className={input}
            />
          </label>
        </div>
      )}
    </div>
  );
}
