"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { deleteExpenseAction } from "@/app/(app)/finance/actions";

export default function DeleteExpenseButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (!confirm("Delete this expense?")) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteExpenseAction(id);
      if (!r.ok) setError(r.error);
    });
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={error ?? "Delete"}
      className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-500 dark:text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
    >
      {pending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
    </button>
  );
}
