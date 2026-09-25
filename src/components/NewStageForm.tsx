"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  createStageFormAction,
  createVideoUploadUrlAction,
  attachStageVideoAction,
  type CreateStageFormState,
} from "@/app/(app)/stages/actions";
import { PendingVideosContext } from "./pending-videos-context";

type VideoStatus = { name: string; state: "waiting" | "uploading" | "done" | "error"; error?: string };

/**
 * Client shell around the New Stage form. A failed create shows its
 * reason inline with every input left as typed. A successful create
 * returns the new id; any videos picked are then uploaded straight to
 * storage under that id (they can't ride the form post) before the
 * page moves to the new stage.
 */
export default function NewStageForm({
  children,
  className,
  videoMaxBytes = 0,
}: {
  children: React.ReactNode;
  className?: string;
  /** 0 disables video picking (storage for large files isn't set up). */
  videoMaxBytes?: number;
}) {
  const [state, formAction] = useActionState<CreateStageFormState, FormData>(
    createStageFormAction,
    null,
  );
  const [videos, setVideosState] = useState<File[]>([]);
  const [progress, setProgress] = useState<VideoStatus[] | null>(null);
  const router = useRouter();
  const handled = useRef<string | null>(null);

  // Once the stage exists, push the queued videos up and move on.
  useEffect(() => {
    if (!state || !("id" in state) || handled.current === state.id) return;
    handled.current = state.id;
    const stageId = state.id;
    const queue = videos;

    (async () => {
      if (queue.length === 0) {
        router.push(`/stages/${stageId}`);
        return;
      }
      const statuses: VideoStatus[] = queue.map((f) => ({ name: f.name, state: "waiting" }));
      setProgress([...statuses]);
      let failures = 0;
      for (let i = 0; i < queue.length; i++) {
        const file = queue[i];
        statuses[i] = { ...statuses[i], state: "uploading" };
        setProgress([...statuses]);
        try {
          const contentType = file.type || "video/mp4";
          const presigned = await createVideoUploadUrlAction(stageId, file.name, contentType);
          if (!presigned) throw new Error("Video storage isn't configured.");
          const res = await fetch(presigned.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: file,
          });
          if (!res.ok) throw new Error(`Upload failed (${res.status})`);
          await attachStageVideoAction(stageId, presigned.storagePath);
          statuses[i] = { ...statuses[i], state: "done" };
        } catch (e: unknown) {
          failures++;
          statuses[i] = {
            ...statuses[i],
            state: "error",
            error: e instanceof Error && e.message ? e.message : "Upload failed",
          };
        }
        setProgress([...statuses]);
      }
      // All good → go. Any failure → stay so the message is readable,
      // with a link through to the stage (it was created either way).
      if (failures === 0) router.push(`/stages/${stageId}`);
    })();
  }, [state, videos, router]);

  const stageId = state && "id" in state ? state.id : null;
  const uploading = !!progress && progress.some((p) => p.state === "uploading" || p.state === "waiting");

  return (
    <PendingVideosContext.Provider
      value={{
        videos,
        setVideos: (update) => setVideosState((prev) => update(prev)),
        maxBytes: videoMaxBytes,
      }}
    >
      <form action={formAction} className={className}>
        {state && "error" in state && (
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

        {progress && (
          <div
            role="status"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5 text-sm space-y-1.5"
          >
            <div className="font-medium text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
              {uploading && <Loader2 size={14} className="animate-spin" />}
              Stage created — {uploading ? "uploading video…" : "video upload finished"}
            </div>
            <ul className="space-y-0.5 text-xs">
              {progress.map((p, i) => (
                <li key={i} className="flex items-center gap-2 break-all">
                  <span className="truncate flex-1">{p.name}</span>
                  <span
                    className={
                      p.state === "error"
                        ? "text-rose-700 dark:text-rose-300"
                        : p.state === "done"
                          ? "text-emerald-700 dark:text-emerald-300"
                          : "text-slate-500"
                    }
                  >
                    {p.state === "error" ? p.error : p.state === "done" ? "Uploaded" : p.state === "uploading" ? "Uploading…" : "Waiting"}
                  </span>
                </li>
              ))}
            </ul>
            {!uploading && progress.some((p) => p.state === "error") && stageId && (
              <p className="text-xs text-slate-600 dark:text-slate-400">
                The stage was saved. You can add the video again from{" "}
                <Link href={`/stages/${stageId}`} className="text-brand underline">
                  the stage page
                </Link>
                .
              </p>
            )}
          </div>
        )}

        <fieldset disabled={!!stageId} className="contents">
          {children}
        </fieldset>
      </form>
    </PendingVideosContext.Provider>
  );
}
