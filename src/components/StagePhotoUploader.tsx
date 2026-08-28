"use client";

import { useEffect, useState } from "react";
import {
  Camera,
  CloudUpload,
  Loader2,
  X,
  Image as ImageIcon,
  AlertCircle,
  Play,
} from "lucide-react";
import { compressImage } from "@/lib/image-compress";
import { createClient } from "@/lib/supabase/client";
import { addToOutbox, isNetworkError } from "@/lib/photo-outbox";

/**
 * Auto-uploading multi-photo/-video picker for the stage detail page.
 *
 * Photos: pick → compress client-side (HEIC → JPEG, ≤1920px, q≈0.82) →
 * upload via the bound server action (small enough for Vercel's request
 * body limit).
 *
 * Videos: too big to round-trip through a server action (Vercel caps the
 * request body at ~4.5 MB), so they upload DIRECTLY from the browser to
 * Supabase Storage with the user's session, then a lightweight server
 * action (`videoAction`) records just the metadata row. Video upload is
 * only offered when `videoAction` + `stageId` are supplied.
 */

// Effective cap is the lower of this and the Supabase project's storage
// upload limit (Dashboard → Storage → Settings). Keep them in sync.
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB
const BUCKET = "stage-photos";

type Status = "optimizing" | "uploading" | "queued" | "error";

type Item = {
  // Stable id for keying / removal even before we have a File.
  id: string;
  kind: "image" | "video";
  file: File | null;
  previewUrl: string | null;
  status: Status;
  error?: string;
};

export default function StagePhotoUploader({
  action,
  videoAction,
  videoUploadUrlAction,
  maxVideoBytes = MAX_VIDEO_BYTES,
  stageId,
}: {
  action: (formData: FormData) => Promise<void> | void;
  /** Records a video already uploaded to Storage. Enables video picking. */
  videoAction?: (storagePath: string) => Promise<void> | void;
  /**
   * Mints a presigned R2 upload URL. When supplied (R2 configured), videos
   * go to R2 and the 50 MB Supabase ceiling doesn't apply.
   */
  videoUploadUrlAction?: (
    stageId: string,
    fileName: string,
    contentType: string,
  ) => Promise<{ uploadUrl: string; storagePath: string } | null>;
  /** Max video size in bytes. Defaults to the Supabase-plan ceiling. */
  maxVideoBytes?: number;
  /** Required for video uploads — used to namespace the storage path. */
  stageId?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);

  const videoEnabled = !!(videoAction && stageId);
  const accept = videoEnabled
    ? "image/*,image/heic,image/heif,video/*"
    : "image/*,image/heic,image/heif";

  // Revoke preview blobs when items disappear.
  useEffect(() => {
    return () => {
      for (const it of items) {
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      }
    };
    // We only run cleanup on unmount — individual blob cleanup is
    // handled when we remove an item below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function newId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((it) => it.id !== id);
    });
  }

  function updateItem(id: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function handleVideo(rawFile: File) {
    const id = newId();
    let previewUrl: string | null = null;
    try {
      previewUrl = URL.createObjectURL(rawFile);
    } catch {
      previewUrl = null;
    }

    if (rawFile.size > maxVideoBytes) {
      setItems((prev) => [
        ...prev,
        {
          id,
          kind: "video",
          file: rawFile,
          previewUrl,
          status: "error",
          error: `Video is too large (max ${Math.round(
            maxVideoBytes / (1024 * 1024),
          )} MB).`,
        },
      ]);
      return;
    }

    setItems((prev) => [
      ...prev,
      { id, kind: "video", file: rawFile, previewUrl, status: "uploading" },
    ]);

    const safe = rawFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const contentType = rawFile.type || "video/mp4";
    const supabasePath = `${stageId}/${Date.now()}-${safe}`;
    const supabase = createClient();
    // Where the bytes actually landed, so a failed metadata write can be
    // rolled back against the right store.
    let uploadedTo: "r2" | "supabase" | null = null;
    let recordedPath = supabasePath;
    try {
      // Prefer R2 when it's configured — it has no 50 MB ceiling.
      const presigned = videoUploadUrlAction
        ? await videoUploadUrlAction(stageId!, safe, contentType)
        : null;

      if (presigned) {
        const res = await fetch(presigned.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: rawFile,
        });
        if (!res.ok) {
          throw new Error(`Upload failed (${res.status})`);
        }
        uploadedTo = "r2";
        recordedPath = presigned.storagePath;
      } else {
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(supabasePath, rawFile, { contentType, upsert: false });
        if (error) throw new Error(error.message);
        uploadedTo = "supabase";
      }

      // Record the metadata row (separate server-action round-trip).
      await videoAction!(recordedPath);
      removeItem(id);
    } catch (e: any) {
      // The bytes uploaded but recording the row failed — roll back the
      // now-orphaned object so it doesn't sit unreferenced (nothing else
      // ever cleans up a row-less object). R2 orphans are left to the
      // server-side delete path; we can't sign a DELETE from here.
      if (uploadedTo === "supabase") {
        try {
          await supabase.storage.from(BUCKET).remove([supabasePath]);
        } catch {
          // Best-effort; leave the orphan rather than masking the real error.
        }
      }
      updateItem(id, {
        status: "error",
        error: e?.message || "Upload failed",
      });
    }
  }

  async function handleImage(rawFile: File) {
    const id = newId();
    // Lightweight preview based on the original file so the user sees
    // something immediately while compression runs.
    let previewUrl: string | null = null;
    try {
      previewUrl = URL.createObjectURL(rawFile);
    } catch {
      previewUrl = null;
    }
    setItems((prev) => [
      ...prev,
      { id, kind: "image", file: null, previewUrl, status: "optimizing" },
    ]);

    let compressed: File;
    try {
      compressed = await compressImage(rawFile);
    } catch (e: any) {
      updateItem(id, {
        status: "error",
        error: e?.message || "Couldn't process this image.",
      });
      return;
    }

    // Plainly offline? Skip the doomed attempt and queue straight away.
    if (stageId && typeof navigator !== "undefined" && !navigator.onLine) {
      await queueForLater(id, compressed);
      return;
    }
    updateItem(id, { file: compressed, status: "uploading" });

    try {
      const fd = new FormData();
      fd.set("file", compressed);
      // Stable key → deterministic storage path server-side, so a
      // retried upload (flaky link, outbox drain) can't duplicate.
      fd.set("client_key", id);
      await action(fd);
      // Success — drop from local state. The parent grid will refresh
      // via revalidatePath inside the server action.
      removeItem(id);
    } catch (e: any) {
      // Network-shaped failures go to the offline outbox instead of
      // being lost — the photo uploads itself when signal returns.
      if (stageId && isNetworkError(e)) {
        await queueForLater(id, compressed);
        return;
      }
      updateItem(id, {
        status: "error",
        error: e?.message || "Upload failed",
      });
    }
  }

  /** Park a compressed photo in the offline outbox (see photo-outbox). */
  async function queueForLater(itemId: string, file: File) {
    try {
      await addToOutbox({
        id: itemId,
        stageId: stageId!,
        name: file.name,
        type: file.type,
        blob: file,
      });
      updateItem(itemId, { status: "queued" });
      // Brief confirmation, then the global outbox pill takes over.
      setTimeout(() => removeItem(itemId), 2500);
    } catch {
      updateItem(itemId, {
        status: "error",
        error: "No connection, and saving for later failed.",
      });
    }
  }

  function handleOne(rawFile: File) {
    if (videoEnabled && rawFile.type.startsWith("video/")) {
      void handleVideo(rawFile);
    } else {
      void handleImage(rawFile);
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    // Kick off all uploads in parallel — the server can handle a few
    // concurrent file POSTs and the user gets done sooner.
    for (const f of picked) handleOne(f);
  }

  const optimizing = items.filter((it) => it.status === "optimizing").length;
  const uploading = items.filter((it) => it.status === "uploading").length;
  const errored = items.filter((it) => it.status === "error").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Photo / video library / multi-select */}
        <label
          htmlFor="stage_photo_library"
          className="text-sm bg-slate-900 text-white rounded-md px-3 py-2 cursor-pointer hover:bg-slate-800 inline-flex items-center gap-2"
        >
          <ImageIcon size={14} />
          {videoEnabled ? "Add photos or video" : "Add photos"}
        </label>
        <input
          id="stage_photo_library"
          type="file"
          accept={accept}
          multiple
          onChange={onChange}
          className="hidden"
        />

        {/* Camera shortcut (photos only) */}
        <label
          htmlFor="stage_photo_camera"
          className="text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 rounded-md px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900 inline-flex items-center gap-2"
        >
          <Camera size={14} />
          Take photo
        </label>
        <input
          id="stage_photo_camera"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onChange}
          className="hidden"
        />

        {(optimizing > 0 || uploading > 0) && (
          <span className="text-xs text-slate-600 dark:text-slate-400 inline-flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            {optimizing > 0 && `Optimizing ${optimizing}`}
            {optimizing > 0 && uploading > 0 && " · "}
            {uploading > 0 && `Uploading ${uploading}`}
          </span>
        )}
        {errored > 0 && (
          <span className="text-xs text-rose-600 inline-flex items-center gap-1">
            <AlertCircle size={12} />
            {errored} failed
          </span>
        )}
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {items.map((it) => (
            <div
              key={it.id}
              className="relative rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            >
              {it.previewUrl &&
                (it.kind === "video" ? (
                  <video
                    src={it.previewUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="w-full h-24 object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.previewUrl}
                    alt=""
                    className="w-full h-24 object-cover"
                  />
                ))}
              {/* Play glyph so a video tile reads as a video. */}
              {it.kind === "video" && it.status !== "error" && (
                <span className="absolute top-1 right-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-black/55 text-white">
                  <Play size={11} fill="currentColor" />
                </span>
              )}
              {/* Status overlay */}
              {(it.status === "optimizing" || it.status === "uploading") && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-[10px] uppercase tracking-wide gap-1">
                  <Loader2 size={12} className="animate-spin" />
                  {it.status === "optimizing" ? "Optimizing" : "Uploading"}
                </div>
              )}
              {it.status === "queued" && (
                <div className="absolute inset-0 bg-amber-900/70 text-white p-1.5 text-[10px] flex flex-col items-center justify-center text-center gap-1">
                  <CloudUpload size={14} />
                  <span className="leading-tight">
                    Saved — uploads when back online
                  </span>
                </div>
              )}
              {it.status === "error" && (
                <div
                  className="absolute inset-0 bg-rose-900/70 text-white p-1.5 text-[10px] flex flex-col items-center justify-center text-center gap-1"
                  title={it.error}
                >
                  <AlertCircle size={14} />
                  <span className="leading-tight">{it.error ?? "Failed"}</span>
                  {/* Catch-all: any failed PHOTO can be parked in the
                      offline outbox instead of being lost — covers
                      failures the network heuristic didn't classify. */}
                  {it.kind === "image" && it.file && stageId && (
                    <button
                      type="button"
                      onClick={() => void queueForLater(it.id, it.file!)}
                      className="mt-1 text-[10px] font-semibold underline"
                    >
                      Save for later
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(it.id)}
                    className="mt-0.5 text-[10px] underline"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
