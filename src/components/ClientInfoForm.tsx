"use client";

import { useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

/**
 * Client-info edit form (name / email / phone / address / notes) with
 * visible save feedback: the button shows "Saving…" while the server
 * action runs, then a green "Saved" check for a couple of seconds —
 * previously the form gave no indication at all, so a successful save
 * was indistinguishable from a dead button.
 *
 * The bound server actions are passed in from the server component.
 * Delete stays a plain formAction so Next handles its redirect natively.
 */
export default function ClientInfoForm({
  updateAction,
  deleteAction,
  isAdmin,
  stageCount = 0,
  defaults,
}: {
  updateAction: (formData: FormData) => Promise<void>;
  deleteAction: () => Promise<void>;
  isAdmin: boolean;
  /** How many stages ride on this client — shown in the delete confirm
   *  since deleting the client CASCADE-deletes every one of them. */
  stageCount?: number;
  defaults: {
    name: string;
    email: string;
    phone: string;
    address: string;
    notes: string;
    /** false = escrow payer, skip automated payment-reminder emails. */
    paymentReminders: boolean;
  };
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <form
      data-no-loader
      action={async (formData) => {
        setStatus("saving");
        if (timer.current) clearTimeout(timer.current);
        try {
          await updateAction(formData);
          setStatus("saved");
          timer.current = setTimeout(() => setStatus("idle"), 2500);
        } catch {
          setStatus("error");
        }
      }}
      className="bg-white dark:bg-slate-900 border rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-3"
    >
      <input
        name="name"
        required
        defaultValue={defaults.name}
        className="border rounded px-3 py-2.5 text-base"
      />
      <input
        name="email"
        defaultValue={defaults.email}
        placeholder="Email"
        className="border rounded px-3 py-2.5 text-base"
      />
      <input
        name="phone"
        defaultValue={defaults.phone}
        placeholder="Phone"
        className="border rounded px-3 py-2.5 text-base"
      />
      <input
        name="address"
        defaultValue={defaults.address}
        placeholder="Address"
        className="border rounded px-3 py-2.5 text-base"
      />
      <textarea
        name="notes"
        defaultValue={defaults.notes}
        placeholder="Notes"
        className="md:col-span-2 border rounded px-3 py-2.5 text-base"
      />
      <label className="md:col-span-2 flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          name="no_payment_reminders"
          defaultChecked={!defaults.paymentReminders}
          className="mt-0.5 h-4 w-4 accent-brand"
        />
        <span>
          Pays through escrow — don&rsquo;t send payment reminders
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            Turns off the automated unpaid-invoice reminder emails (first
            one 5 days after an invoice is sent, then every 3 days, up to
            5 reminders) for this client&rsquo;s stages and extensions.
          </span>
        </span>
      </label>
      <div className="md:col-span-2 flex flex-col sm:flex-row sm:items-center gap-3">
        <button
          disabled={status === "saving"}
          className="bg-slate-900 text-white rounded-lg px-4 py-2.5 inline-flex items-center justify-center gap-2 disabled:opacity-70"
        >
          {status === "saving" ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Saving…
            </>
          ) : (
            "Save"
          )}
        </button>
        {status === "saved" && (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300"
          >
            <Check size={15} /> Saved
          </span>
        )}
        {status === "error" && (
          <span role="alert" className="text-sm text-rose-700">
            Couldn&rsquo;t save — please try again.
          </span>
        )}
        {/* Deleting a client is admin-only — and the database CASCADE-
            deletes every one of their stages (photos, invoices,
            extensions, payments) with it, so the destructive submit
            hides behind an explicit inline confirm. (Inline, not
            window.confirm — webviews suppress that silently.) */}
        {isAdmin && !confirmingDelete && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-red-600 rounded-lg px-4 py-2.5 border border-red-200 sm:ml-auto"
          >
            Delete
          </button>
        )}
      </div>
      {isAdmin && confirmingDelete && (
        <div className="md:col-span-2 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-4 space-y-2">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">
            Permanently delete this client?
          </p>
          <p className="text-sm text-red-700 dark:text-red-300">
            This also permanently deletes{" "}
            {stageCount > 0
              ? `their ${stageCount} stage${stageCount === 1 ? "" : "s"}`
              : "all of their stages"}{" "}
            — photos, invoices, extensions, and payment history included.
            This cannot be undone.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              formAction={deleteAction}
              className="bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Yes — delete permanently
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-lg px-4 py-2 text-sm border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
