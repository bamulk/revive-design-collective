"use client";

import { useTransition } from "react";

/**
 * Tiny client wrapper around the delete server action — exists only
 * because we want a confirm() prompt before the form posts, and
 * server components can't carry onClick handlers.
 */
export default function RemoveEmployeeButton({
  action,
  label,
}: {
  action: () => Promise<void>;
  label: string;
}) {
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (
      !confirm(
        `Remove ${label} from the team? Their account will be deleted.`,
      )
    ) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    startTransition(async () => {
      await action();
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end"
    >
      <button
        type="submit"
        disabled={pending}
        className="text-red-600 dark:text-red-400 text-xs hover:underline disabled:opacity-60"
      >
        {pending ? "Removing…" : "Remove"}
      </button>
    </form>
  );
}
