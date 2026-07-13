"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { useStageEdit } from "./StageEditClient";

/**
 * Edit-form wrapper.
 *
 * On submit it flips to the read-only view IMMEDIATELY (client state) and
 * fires the save as a background fetch() to /api/stages/[id]. The user
 * never waits on a spinner: the transition is instant and the write
 * happens behind it. (A fetch, not a Server Action, so Next never
 * re-renders the route as part of the submit — no loading screen.)
 *
 * After a SUCCESSFUL save we router.refresh() inside a transition so the
 * read-only view re-syncs with the saved values in the background (the
 * current UI stays put while the fresh payload streams in). Without this
 * the page — and the 60s router cache — kept showing the pre-edit
 * values, which made every save look like it didn't stick. (The old
 * post-save "loading screen" this refresh was once blamed for was really
 * the RouteLoader overlay, fixed separately; this form is data-no-loader.)
 *
 * On failure we surface an alert and re-open the form so the edit isn't
 * silently lost.
 */
export default function StageEditForm({
  stageId,
  className,
  children,
}: {
  stageId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { exitEdit, enterEdit } = useStageEdit();
  const router = useRouter();
  return (
    <form
      className={className}
      data-no-loader
      action={(formData) => {
        // Flip to the read-only view right away — no waiting on the save.
        exitEdit();
        fetch(`/api/stages/${stageId}`, { method: "POST", body: formData })
          .then((res) => {
            if (!res.ok) {
              alert("Couldn't save the stage. Re-opening your edits.");
              enterEdit();
              return;
            }
            // Pull the saved values into the read-only view.
            startTransition(() => router.refresh());
          })
          .catch(() => {
            alert("Couldn't save the stage. Re-opening your edits.");
            enterEdit();
          });
      }}
    >
      {children}
    </form>
  );
}
