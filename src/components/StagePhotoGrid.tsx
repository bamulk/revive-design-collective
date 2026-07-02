"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ChevronDown, ChevronUp, Loader2, Play, Star, Trash2 } from "lucide-react";
import PhotoLightbox from "./PhotoLightbox";
import { setStagePrimaryPhotoAction } from "@/app/(app)/stages/actions";

export type StagePhoto = {
  id: string;
  /** "image" (default) or "video" — drives <img> vs <video> rendering. */
  kind?: "image" | "video";
  thumbUrl: string;
  fullUrl: string;
  /** True when this photo is the admin-chosen "main" card image. At
   *  most one photo per stage has this set; falsy means the legacy
   *  earliest-by-created_at fallback is in effect. */
  isPrimary?: boolean;
  /** Bound server action: deletePhotoAction.bind(null, photoId, stageId) */
  deleteAction: () => Promise<void> | void;
};

/**
 * Stage detail photo grid. Each thumbnail opens a full-screen lightbox
 * with swipe + keyboard navigation; the small × button (admin only)
 * fires the existing server action without triggering the lightbox.
 *
 * By default the grid shows the first 2 photos on mobile (one row of
 * grid-cols-2) and the first 4 on desktop (one row of md:grid-cols-4).
 * A toggle button reveals the rest — visible on mobile when there are
 * 3+ photos, on desktop only when there are 5+.
 */
export default function StagePhotoGrid({
  stageId,
  photos,
  canEditPrimary = false,
}: {
  stageId?: string;
  photos: StagePhoto[];
  /** Admin-only — when true, each photo gets a star toggle that marks
   *  it as the stage's main / card photo. */
  canEditPrimary?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Per-photo "armed for delete" state — only one photo can be armed
  // at a time. Clicking outside / on another photo's delete clears it.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Optimistic primary id so the star flips instantly on click.
  const initialPrimaryId =
    photos.find((p) => p.isPrimary)?.id ?? null;
  const [primaryId, setPrimaryId] = useOptimistic<string | null, string | null>(
    initialPrimaryId,
    (_, next) => next,
  );

  function togglePrimary(photoId: string) {
    if (!stageId || !canEditPrimary) return;
    const wasPrimary = primaryId === photoId;
    const nextPrimaryId = wasPrimary ? null : photoId;
    startTransition(async () => {
      setPrimaryId(nextPrimaryId);
      setPendingId(photoId);
      try {
        await setStagePrimaryPhotoAction(photoId, stageId);
      } finally {
        setPendingId(null);
      }
    });
  }

  if (photos.length === 0) {
    return <p className="text-sm text-slate-700 dark:text-slate-300 col-span-full">No photos yet.</p>;
  }

  const lightboxPhotos = photos.map((p) => ({
    id: p.id,
    url: p.fullUrl,
    kind: p.kind ?? "image",
  }));
  const deleteById = new Map(photos.map((p) => [p.id, p.deleteAction]));

  // Tailwind responsive classes for hiding "overflow" photos when
  // collapsed: indices 2-3 hide on mobile only (desktop shows 4),
  // indices 4+ hide on all sizes.
  function hiddenClass(i: number) {
    if (expanded) return "";
    if (i < 2) return "";
    if (i < 4) return "hidden sm:block";
    return "hidden";
  }

  const hasMobileOverflow = photos.length > 2;
  const hasDesktopOverflow = photos.length > 4;
  const showToggle = hasMobileOverflow;

  return (
    <PhotoLightbox
      photos={lightboxPhotos}
      onDelete={async (id) => {
        const fn = deleteById.get(id);
        if (fn) await fn();
      }}
    >
      {(open) => (
        <>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map((p, i) => (
            <div
              key={p.id}
              className={`relative group rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 ${hiddenClass(i)}`}
            >
              <button
                type="button"
                onClick={() => open(p.id)}
                aria-label={p.kind === "video" ? "Play video" : "Open full size"}
                className="block w-full text-left"
              >
                {p.kind === "video" ? (
                  <div className="relative">
                    <video
                      src={p.thumbUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="w-full h-36 object-cover bg-black"
                    />
                    {/* Play badge so a video tile is recognizable. */}
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-black/55 text-white">
                        <Play size={18} fill="currentColor" />
                      </span>
                    </span>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.thumbUrl}
                    alt=""
                    loading="lazy"
                    className="w-full h-36 object-cover"
                  />
                )}
              </button>
              {/* Star — admin-only "main photo" toggle. Images only; a
                  video can't be the image-transformed card thumbnail. */}
              {canEditPrimary && p.kind !== "video" && (
                <button
                  type="button"
                  onClick={() => togglePrimary(p.id)}
                  aria-label={
                    primaryId === p.id
                      ? "Remove main photo"
                      : "Set as main photo"
                  }
                  title={
                    primaryId === p.id
                      ? "Main photo — tap again to clear"
                      : "Set as main photo"
                  }
                  disabled={pendingId === p.id}
                  className={`absolute top-1.5 left-1.5 w-8 h-8 inline-flex items-center justify-center rounded-full transition shadow-md disabled:opacity-70 ${
                    primaryId === p.id
                      ? "bg-amber-400 text-amber-900 hover:bg-amber-500"
                      : "bg-black/55 text-white opacity-90 hover:opacity-100 hover:bg-amber-500 hover:text-amber-900"
                  }`}
                >
                  {pendingId === p.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Star
                      size={14}
                      fill={primaryId === p.id ? "currentColor" : "none"}
                    />
                  )}
                </button>
              )}
              {/* Main-photo badge — shows on the rendered card so the
                  designation is visible even at-a-glance. */}
              {primaryId === p.id && (
                <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-400 text-amber-900 shadow-sm">
                  <Star size={10} fill="currentColor" /> Main
                </span>
              )}
              {/* Two-step inline delete — first tap arms the button,
                  second tap submits. Matches the pattern used for
                  payments / extensions / stage delete so the whole
                  app behaves the same way. */}
              <PhotoDeleteButton
                isArmed={confirmDeleteId === p.id}
                arm={() => setConfirmDeleteId(p.id)}
                cancel={() => setConfirmDeleteId(null)}
                deleteAction={p.deleteAction}
              />
            </div>
          ))}
        </div>
        {showToggle && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            // When there are fewer than 5 photos, mobile is the only
            // viewport with anything to expand — hide the button at
            // sm+ so desktop doesn't see a no-op toggle.
            className={`mt-3 inline-flex items-center gap-1 text-sm text-brand hover:text-brand-hover ${
              hasDesktopOverflow ? "" : "sm:hidden"
            }`}
          >
            {expanded ? (
              <>
                Show fewer <ChevronUp size={14} />
              </>
            ) : (
              <>
                Show all {photos.length} photos <ChevronDown size={14} />
              </>
            )}
          </button>
        )}
        </>
      )}
    </PhotoLightbox>
  );
}

/**
 * Per-photo delete button. Two states:
 *  - idle: small dark circle with a trash icon in the corner.
 *  - armed: a "Delete?" pill spanning a couple chips wide with Cancel
 *    and Delete actions. Cancel returns to idle; Delete submits the
 *    bound server action (rendered inside a real <form> so Next picks
 *    up the action correctly).
 */
function PhotoDeleteButton({
  isArmed,
  arm,
  cancel,
  deleteAction,
}: {
  isArmed: boolean;
  arm: () => void;
  cancel: () => void;
  deleteAction: () => Promise<void> | void;
}) {
  if (!isArmed) {
    return (
      <button
        type="button"
        onClick={arm}
        aria-label="Delete photo"
        className="absolute top-1.5 right-1.5 w-8 h-8 inline-flex items-center justify-center rounded-full bg-black/55 text-white opacity-90 hover:opacity-100 active:opacity-100 hover:bg-rose-700 transition shadow-md"
      >
        <Trash2 size={14} />
      </button>
    );
  }
  return (
    <div className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-full bg-rose-50 ring-1 ring-rose-200 px-1 py-0.5 shadow-md">
      <button
        type="button"
        onClick={cancel}
        className="text-[11px] font-medium text-rose-800 px-2 py-0.5 rounded-full hover:bg-rose-100"
      >
        Cancel
      </button>
      <form data-no-loader action={deleteAction}>
        <button
          type="submit"
          autoFocus
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-rose-700 hover:bg-rose-800 px-2 py-0.5 rounded-full"
        >
          <Trash2 size={11} /> Delete
        </button>
      </form>
    </div>
  );
}
