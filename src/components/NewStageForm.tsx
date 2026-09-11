"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import {
  createStageFormAction,
  type CreateStageFormState,
} from "@/app/(app)/stages/actions";

/**
 * Client shell around the New Stage form so a failed create shows its
 * reason inline. Because a returned error doesn't navigate, every
 * uncontrolled input keeps what the admin typed.
 */
export default function NewStageForm({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState<CreateStageFormState, FormData>(
    createStageFormAction,
    null,
  );
  return (
    <form action={formAction} className={className}>
      {state?.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2.5 text-sm text-rose-800 dark:text-rose-200"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Couldn&rsquo;t create the stage</div>
            <div>{state.error}</div>
          </div>
        </div>
      )}
      {children}
    </form>
  );
}
