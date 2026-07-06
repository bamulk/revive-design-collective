"use client";

import { useState, useTransition } from "react";
import {
  UserPlus,
  Mail,
  Check,
  Loader2,
  X,
  Edit3,
} from "lucide-react";
import { updateStageSecondaryRecipientAction } from "@/app/(app)/stages/actions";

/**
 * Admin-only stage-page section for adding / editing / removing the
 * secondary signer + payer (homeowner / co-payer) AFTER a stage has
 * been created. Saving updates the stage row; if a signature was
 * already sent, the action auto-triggers a fresh signature envelope
 * so both signers get a signing link. Invoice + estimate sends going
 * forward CC the secondary automatically.
 */
export default function SecondaryRecipientSection({
  stageId,
  name,
  email,
  hasSignatureEnvelope,
  bare = false,
}: {
  stageId: string;
  name: string | null;
  email: string | null;
  /** True if a signature envelope has already been sent for this stage.
   *  Used only to tweak the help-text — the server action does the
   *  actual decision. */
  hasSignatureEnvelope: boolean;
  /** When true, render without the outer card wrapper — for embedding
   *  inside another section (e.g. under the Signature card). */
  bare?: boolean;
}) {
  const hasSecondary = !!(name && email);
  const [editing, setEditing] = useState(!hasSecondary);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setToast(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateStageSecondaryRecipientAction(stageId, fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      setToast(
        res.resentSignature
          ? "Saved — fresh signature envelope sent to both signers."
          : "Saved.",
      );
      // Hide the toast after a few seconds.
      setTimeout(() => setToast(null), 4000);
    });
  }

  function remove() {
    if (!confirm("Remove the secondary signer / payer from this stage?")) return;
    setError(null);
    setToast(null);
    const fd = new FormData();
    fd.set("secondary_recipient_name", "");
    fd.set("secondary_recipient_email", "");
    startTransition(async () => {
      const res = await updateStageSecondaryRecipientAction(stageId, fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(true);
      setToast("Secondary recipient removed.");
      setTimeout(() => setToast(null), 4000);
    });
  }

  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    bare ? (
      <div className="space-y-3">{children}</div>
    ) : (
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
        {children}
      </section>
    );

  return (
    <Wrapper>
      <div className="flex items-center justify-between gap-3">
        <h2
          className={
            bare
              ? "text-sm font-medium tracking-tight inline-flex items-center gap-2 text-slate-700 dark:text-slate-300"
              : "text-base font-semibold tracking-tight inline-flex items-center gap-2"
          }
        >
          <UserPlus size={bare ? 14 : 16} className="text-slate-500" />
          Secondary signer / payer
        </h2>
        {hasSecondary && !editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setToast(null);
            }}
            className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <Edit3 size={12} /> Edit
          </button>
        )}
      </div>

      {!editing && hasSecondary ? (
        <div className="space-y-2">
          <div className="text-sm">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              {name}
            </div>
            <div className="text-slate-600 dark:text-slate-400 inline-flex items-center gap-1.5">
              <Mail size={12} /> {email}
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Both names appear on the contract, both signatures are required,
            and every invoice / estimate send CC&apos;s this person.
          </p>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="inline-flex items-center gap-1 text-xs text-rose-700 dark:text-rose-300 hover:text-rose-900 disabled:opacity-50"
          >
            <X size={12} /> Remove secondary recipient
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            For when the homeowner pays (or splits) with the client. Applies
            to this stage only — saving CCs them on this stage&apos;s future
            invoice emails
            {hasSignatureEnvelope
              ? " and immediately sends a fresh signature request for this stage to both signers."
              : ". They'll be added to this stage's contract the next time you send it for signature."}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              name="secondary_recipient_name"
              required
              defaultValue={name ?? ""}
              placeholder="Homeowner full name"
              className="border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-sm bg-white dark:bg-slate-900"
            />
            <input
              type="email"
              name="secondary_recipient_email"
              required
              defaultValue={email ?? ""}
              placeholder="homeowner@example.com"
              className="border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-sm bg-white dark:bg-slate-900"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 bg-slate-900 text-white rounded px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              Save
            </button>
            {hasSecondary && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {error && (
        <p className="text-xs text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-200 border border-rose-200 dark:border-rose-900/60 rounded p-2">
          {error}
        </p>
      )}
      {toast && (
        <p className="text-xs text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded p-2 inline-flex items-center gap-1.5">
          <Check size={12} /> {toast}
        </p>
      )}
    </Wrapper>
  );
}
