"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CloudUpload, Loader2 } from "lucide-react";
import { uploadStagePhotoAction } from "@/app/(app)/stages/actions";
import {
  OUTBOX_EVENT,
  bumpAttempts,
  isNetworkError,
  listOutbox,
  removeFromOutbox,
  resetAllAttempts,
} from "@/lib/photo-outbox";

/**
 * Floating pill (above the bottom nav) showing photos parked in the
 * offline outbox, and the engine that drains them: on app open, when
 * connectivity returns, and on a slow interval, queued photos are
 * re-uploaded through the same server action as a normal upload.
 *
 * Safety:
 * - Web Locks guard the drain, so two tabs/windows can't upload the
 *   same photo concurrently (per-tab ref remains as a fallback).
 * - Each photo carries its outbox id as client_key → deterministic
 *   storage path server-side → a re-send of an already-delivered photo
 *   fails with "already exists" and is treated as delivered.
 * - Items are only removed after success; a photo that keeps being
 *   REJECTED (not network trouble) stops retrying after MAX_ATTEMPTS
 *   and the pill flips to a tappable "couldn't upload — tap to retry".
 */
const MAX_ATTEMPTS = 8;

function isAlreadyDelivered(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e ?? "").toLowerCase();
  return msg.includes("already exists") || msg.includes("duplicate");
}

export default function PhotoOutboxPill() {
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [draining, setDraining] = useState(false);
  const drainingRef = useRef(false);

  const refreshCounts = useCallback(async () => {
    try {
      const items = await listOutbox();
      setPending(items.filter((i) => (i.attempts ?? 0) < MAX_ATTEMPTS).length);
      setFailed(items.filter((i) => (i.attempts ?? 0) >= MAX_ATTEMPTS).length);
    } catch {
      // IndexedDB unavailable (private mode) — pill just stays hidden.
    }
  }, []);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    const run = async () => {
      drainingRef.current = true;
      setDraining(true);
      try {
        const items = await listOutbox();
        for (const item of items) {
          if (!navigator.onLine) break;
          if ((item.attempts ?? 0) >= MAX_ATTEMPTS) continue;
          try {
            const fd = new FormData();
            fd.set(
              "file",
              new File([item.blob], item.name || "photo.jpg", {
                type: item.type || "image/jpeg",
              }),
            );
            fd.set("client_key", item.id);
            await uploadStagePhotoAction(item.stageId, fd);
            await removeFromOutbox(item.id);
          } catch (e) {
            if (isAlreadyDelivered(e)) {
              // A previous attempt landed but we never saw the response.
              await removeFromOutbox(item.id);
              continue;
            }
            if (isNetworkError(e)) break; // still offline — retry later
            // Server rejected it — count the attempt; MAX_ATTEMPTS
            // flips it into the "couldn't upload" state.
            await bumpAttempts(item);
            console.error("[photo-outbox] upload failed:", item.id, e);
          }
        }
      } finally {
        drainingRef.current = false;
        setDraining(false);
        void refreshCounts();
      }
    };

    // Cross-tab exclusivity — skip if another tab is already draining.
    const locks = (navigator as any).locks;
    if (locks?.request) {
      await locks.request(
        "shs-photo-outbox-drain",
        { ifAvailable: true },
        async (lock: unknown) => {
          if (!lock) return;
          await run();
        },
      );
    } else {
      await run();
    }
  }, [refreshCounts]);

  useEffect(() => {
    void refreshCounts();
    // Drain shortly after app open (photos queued last session).
    const boot = setTimeout(() => void drain(), 4000);
    const onOnline = () => void drain();
    const onChanged = () => {
      void refreshCounts();
      void drain();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener(OUTBOX_EVENT, onChanged);
    const interval = setInterval(() => void drain(), 60_000);
    return () => {
      clearTimeout(boot);
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(OUTBOX_EVENT, onChanged);
    };
  }, [drain, refreshCounts]);

  const total = pending + failed;
  if (total === 0) return null;

  const retryFailed = () => {
    void (async () => {
      await resetAllAttempts();
      await drain();
    })();
  };

  return (
    <button
      type="button"
      onClick={failed > 0 && !draining ? retryFailed : undefined}
      role="status"
      className={`fixed left-1/2 -translate-x-1/2 z-[1250] flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium shadow-lg ${
        failed > 0 && !draining
          ? "bg-rose-700 text-white"
          : "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
      }`}
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" }}
    >
      {draining ? (
        <>
          <Loader2 size={13} className="animate-spin" />
          Uploading {pending} saved photo{pending === 1 ? "" : "s"}…
        </>
      ) : failed > 0 ? (
        <>
          <AlertCircle size={13} />
          {failed} photo{failed === 1 ? "" : "s"} couldn&rsquo;t upload — tap
          to retry
        </>
      ) : (
        <>
          <CloudUpload size={13} />
          {pending} photo{pending === 1 ? "" : "s"} saved — uploads when
          online
        </>
      )}
    </button>
  );
}
