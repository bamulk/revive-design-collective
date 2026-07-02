"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

/**
 * Submit button with built-in pending state. Reads the parent
 * <form action={...}> status via React's useFormStatus hook, so the
 * button automatically disables itself + swaps to a spinner +
 * "pending label" once the form is submitting. No state plumbing needed
 * — drop it inside any server-action form.
 */
export default function SubmitButton({
  children,
  pendingLabel,
  className = "bg-slate-900 text-white rounded-lg px-4 py-2.5 w-full sm:w-auto disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2",
}: {
  children: React.ReactNode;
  /** Text shown next to the spinner while the form is submitting. */
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? (
        <>
          <Loader2 size={14} className="animate-spin" />
          {pendingLabel ?? "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}
