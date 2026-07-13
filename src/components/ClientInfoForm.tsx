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
  defaults,
}: {
  updateAction: (formData: FormData) => Promise<void>;
  deleteAction: () => Promise<void>;
  isAdmin: boolean;
  defaults: {
    name: string;
    email: string;
    phone: string;
    address: string;
    notes: string;
  };
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
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
        {/* Deleting a client is admin-only. */}
        {isAdmin && (
          <button
            formAction={deleteAction}
            className="text-red-600 rounded-lg px-4 py-2.5 border border-red-200 sm:ml-auto"
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}
