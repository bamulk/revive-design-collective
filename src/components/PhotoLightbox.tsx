"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, Trash2 } from "lucide-react";

export type LightboxPhoto = {
  id: string;
  url: string;
  /** "image" (default) or "video". Videos render with native controls
   *  and skip the zoom/pan gestures. */
  kind?: "image" | "video";
};

interface Props {
  photos: LightboxPhoto[];
  /** Render-prop for the thumbnail row — you decide the layout. */
  children: (open: (id: string) => void) => React.ReactNode;
  /**
   * Optional delete callback. When provided, a trash icon appears
   * next to the close button. The callback receives the photo id
   * and should perform the delete + revalidation; the lightbox
   * advances to the next photo (or closes if it was the last one).
   */
  onDelete?: (id: string) => Promise<void> | void;
}

/**
 * Click-to-zoom photo viewer with swipe + keyboard navigation.
 *
 * - Tap a thumbnail → full-screen overlay opens to that photo
 * - Swipe left/right (touch) or arrow keys → navigate
 * - Pinch / double-tap / scroll-wheel → zoom in & pan around
 * - Tap outside / X / Escape → close
 *
 * While zoomed in:
 *   - Single-finger drag pans the photo
 *   - Swipe-navigation is disabled (so you can drag freely without
 *     accidentally jumping photos)
 *   - Double-tap zooms back out
 *
 * Changing photo (next/prev) resets zoom to 1×.
 */
export default function PhotoLightbox({ photos, children, onDelete }: Props) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // Zoom / pan state. scale=1 means fitted, no offset.
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  // Touch tracking for swipe / pan / pinch.
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null,
  );
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef<number>(0);

  const isOpen = openIdx !== null;
  const isZoomed = scale > 1.01;

  function resetZoom() {
    setScale(1);
    setTx(0);
    setTy(0);
  }

  function open(id: string) {
    const i = photos.findIndex((p) => p.id === id);
    if (i >= 0) {
      resetZoom();
      setOpenIdx(i);
    }
  }
  function close() {
    resetZoom();
    setOpenIdx(null);
  }
  function next() {
    if (openIdx === null) return;
    resetZoom();
    setOpenIdx((openIdx + 1) % photos.length);
  }
  function prev() {
    if (openIdx === null) return;
    resetZoom();
    setOpenIdx((openIdx - 1 + photos.length) % photos.length);
  }

  // Keyboard nav + lock the body scroll while the lightbox is up.
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "0") resetZoom();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function clampScale(s: number) {
    return Math.max(1, Math.min(6, s));
  }

  function onWheel(e: React.WheelEvent) {
    e.stopPropagation();
    // Zoom is image-only; videos use native controls.
    if (openIdx !== null && photos[openIdx]?.kind === "video") return;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = clampScale(scale * factor);
    if (newScale === 1) {
      resetZoom();
    } else {
      setScale(newScale);
    }
  }

  function onImgClick(e: React.MouseEvent) {
    e.stopPropagation();
    // Double-click toggle zoom on desktop.
    if (e.detail === 2) {
      if (isZoomed) resetZoom();
      else setScale(2.5);
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      // Pinch start
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchStart.current = { dist, scale };
      touchStartX.current = null;
      touchStartY.current = null;
      panStart.current = null;
      return;
    }
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
    if (isZoomed) {
      panStart.current = { x: t.clientX, y: t.clientY, tx, ty };
    }

    // Double-tap detection (mobile)
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (isZoomed) resetZoom();
      else setScale(2.5);
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchStart.current) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = dist / pinchStart.current.dist;
      setScale(clampScale(pinchStart.current.scale * ratio));
      return;
    }
    if (panStart.current && isZoomed) {
      const t = e.touches[0];
      setTx(panStart.current.tx + (t.clientX - panStart.current.x));
      setTy(panStart.current.ty + (t.clientY - panStart.current.y));
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (pinchStart.current) {
      pinchStart.current = null;
      if (scale <= 1.01) resetZoom();
      touchStartX.current = null;
      touchStartY.current = null;
      panStart.current = null;
      return;
    }
    // If we were panning a zoomed image, don't treat as a swipe.
    if (panStart.current) {
      panStart.current = null;
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    if (touchStartX.current == null || isZoomed) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX.current;
    const dy = t.clientY - (touchStartY.current ?? 0);
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else prev();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }

  return (
    <>
      {children(open)}

      {isOpen && (
        <div
          className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center select-none overflow-hidden"
          onClick={close}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onWheel={onWheel}
        >
          {/* Close + delete buttons (top-right, safe-area aware) */}
          <div
            className="absolute right-3 z-10 flex items-center gap-2"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
          >
            {onDelete && (
              <button
                type="button"
                aria-label="Delete photo"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!confirm("Delete this photo?")) return;
                  const removedIdx = openIdx;
                  const removedId = photos[removedIdx].id;
                  // Optimistically advance/close before awaiting so the
                  // overlay doesn't sit on a soon-to-be-stale image.
                  const remaining = photos.length - 1;
                  if (remaining <= 0) {
                    close();
                  } else if (removedIdx >= remaining) {
                    setOpenIdx(remaining - 1);
                  }
                  try {
                    await onDelete(removedId);
                  } catch (err) {
                    console.error("Delete photo failed:", err);
                  }
                }}
                className="w-10 h-10 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-rose-700 text-white"
              >
                <Trash2 size={20} />
              </button>
            )}
            <button
              type="button"
              aria-label="Close"
              onClick={(e) => {
                e.stopPropagation();
                close();
              }}
              className="w-10 h-10 inline-flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white"
            >
              <X size={22} />
            </button>
          </div>

          {/* Counter + zoom indicator */}
          <div
            className="absolute top-4 left-4 z-10 text-white/70 text-sm tabular-nums"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
          >
            {openIdx + 1} / {photos.length}
            {isZoomed && (
              <span className="ml-2 text-white/60">
                · {scale.toFixed(1)}×
              </span>
            )}
          </div>

          {/* Reset-zoom button — only when zoomed */}
          {isZoomed && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                resetZoom();
              }}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs"
              style={{
                bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
              }}
            >
              Reset zoom
            </button>
          )}

          {/* Media — video plays with native controls (no zoom/pan);
              image keeps the pinch/zoom/pan behavior. */}
          {photos[openIdx].kind === "video" ? (
            <video
              crossOrigin="anonymous"
              key={photos[openIdx].id}
              src={photos[openIdx].url}
              controls
              autoPlay
              playsInline
              className="max-w-[100vw] max-h-[100vh] w-auto h-auto object-contain"
              // Isolate the player from the lightbox's tap/swipe/zoom
              // gestures so scrubbing and controls work normally.
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              crossOrigin="anonymous"
              src={photos[openIdx].url}
              alt=""
              onClick={onImgClick}
              onDoubleClick={(e) => e.stopPropagation()}
              className="max-w-[100vw] max-h-[100vh] w-auto h-auto object-contain touch-none"
              style={{
                transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                transition: panStart.current || pinchStart.current
                  ? "none"
                  : "transform 120ms ease-out",
                cursor: isZoomed ? "grab" : "zoom-in",
                willChange: "transform",
              }}
              draggable={false}
            />
          )}

          {/* Prev / Next — hidden on small screens (use swipe instead) */}
          {photos.length > 1 && !isZoomed && (
            <>
              <button
                type="button"
                aria-label="Previous"
                onClick={(e) => {
                  e.stopPropagation();
                  prev();
                }}
                className="hidden sm:inline-flex absolute left-2 top-1/2 -translate-y-1/2 w-12 h-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white"
              >
                <ChevronLeft size={28} />
              </button>
              <button
                type="button"
                aria-label="Next"
                onClick={(e) => {
                  e.stopPropagation();
                  next();
                }}
                className="hidden sm:inline-flex absolute right-2 top-1/2 -translate-y-1/2 w-12 h-12 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white"
              >
                <ChevronRight size={28} />
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
