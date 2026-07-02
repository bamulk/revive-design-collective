"use client";

import { useStageEdit } from "./StageEditClient";

/**
 * Edit-form wrapper.
 *
 * On submit it flips to the read-only view IMMEDIATELY (client state) and
 * fires the save as a background fetch() to /api/stages/[id]. The user
 * never waits on a spinner: the transition is instant and the write
 * happens behind it. (A fetch, not a Server Action, so Next never
 * re-renders the route — no loading screen either.)
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
            }
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
