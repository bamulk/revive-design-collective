"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Pencil, X } from "lucide-react";

/**
 * Client-side edit/view toggle for the stage detail page.
 *
 * Editing used to be a `?edit=1` URL search param, so entering AND
 * leaving edit mode each forced a full server re-render of the heavy
 * detail page that the browser waited on — the "slow save". Now the
 * read-only view and the edit form are BOTH rendered (as props) and we
 * flip between them with client state, so the transition is instant.
 * The save still writes server-side; router.refresh() (in StageEditForm)
 * re-syncs the saved values into the read-only view in the background.
 *
 * `initialEditing` seeds the toggle from the server so a deep link to
 * `?edit=1` still opens in edit mode on first paint.
 */
type Ctx = {
  editing: boolean;
  enterEdit: () => void;
  exitEdit: () => void;
};

const StageEditContext = createContext<Ctx | null>(null);

export function useStageEdit(): Ctx {
  const ctx = useContext(StageEditContext);
  if (!ctx) {
    throw new Error("Stage edit components must be inside <StageEditProvider>");
  }
  return ctx;
}

export function StageEditProvider({
  initialEditing,
  children,
}: {
  initialEditing: boolean;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(initialEditing);
  return (
    <StageEditContext.Provider
      value={{
        editing,
        enterEdit: () => setEditing(true),
        exitEdit: () => setEditing(false),
      }}
    >
      {children}
    </StageEditContext.Provider>
  );
}

/** Shows `form` while editing, `readOnly` otherwise — instant client swap. */
export function StageDetailsSwitch({
  readOnly,
  form,
}: {
  readOnly: ReactNode;
  form: ReactNode;
}) {
  const { editing } = useStageEdit();
  return <>{editing ? form : readOnly}</>;
}

/** Renders its children only in read-only (viewing) mode. */
export function ShowWhenViewing({ children }: { children: ReactNode }) {
  const { editing } = useStageEdit();
  return editing ? null : <>{children}</>;
}

/** Header "Edit" button — flips to edit mode with no navigation. */
export function EnterEditButton() {
  const { enterEdit } = useStageEdit();
  return (
    <button
      type="button"
      onClick={enterEdit}
      className="inline-flex items-center gap-1.5 bg-slate-900 text-white rounded-lg px-3 py-2 text-sm hover:bg-slate-800"
    >
      <Pencil size={14} /> Edit
    </button>
  );
}

/** "Cancel" button inside the edit form — flips back with no navigation. */
export function CancelEditButton() {
  const { exitEdit } = useStageEdit();
  return (
    <button
      type="button"
      onClick={exitEdit}
      className="text-sm text-slate-700 dark:text-slate-300 rounded-lg px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-center hover:bg-slate-50 dark:hover:bg-slate-900 inline-flex items-center justify-center gap-2"
    >
      <X size={14} /> Cancel
    </button>
  );
}
