import { createClient } from "@/lib/supabase/server";
import CollapsibleSection from "@/components/CollapsibleSection";
import StagePhotoGrid from "@/components/StagePhotoGrid";
import StagePhotoUploader from "@/components/StagePhotoUploader";
import {
  uploadStagePhotoAction,
  deleteStagePhotoAction,
  attachStageVideoAction,
} from "@/app/(app)/stages/actions";
import { THUMB, FULL } from "@/lib/photo-urls";
import { signThumbsCached, signPlainCached } from "@/lib/sign-thumbs";

/**
 * Async server component for the stage-page Photos section. Wrapped in
 * Suspense in the parent page so the rest of the page renders without
 * waiting on the per-photo signed-URL minting (the slowest part of the
 * detail page when a stage has 20+ photos).
 *
 * Self-contained: it queries stage_photos itself + signs URLs + binds
 * the upload / delete server actions. The parent just needs to pass
 * the stage id and the viewer's admin status (for the "main photo"
 * star).
 */
export default async function StagePhotos({
  stageId,
}: {
  stageId: string;
}) {
  const supabase = await createClient();

  const { data: photoRows } = await supabase
    .from("stage_photos")
    .select("id, storage_path, is_primary, media_type")
    .eq("stage_id", stageId)
    .order("created_at", { ascending: false });

  const rows = photoRows ?? [];
  const imagePaths = rows
    .filter((p) => p.media_type !== "video")
    .map((p) => p.storage_path);
  const videoPaths = rows
    .filter((p) => p.media_type === "video")
    .map((p) => p.storage_path);

  // Images: Pro image-transform URLs (small webp thumbs for the grid,
  // capped 1920px for the lightbox). Videos: plain signed URLs — the
  // transforms only work on images, and the <video> element streams the
  // original. All three sign in parallel.
  const [thumbByPath, fullByPath, videoByPath] = await Promise.all([
    signThumbsCached("stage-photos", imagePaths, THUMB),
    signThumbsCached("stage-photos", imagePaths, FULL),
    signPlainCached("stage-photos", videoPaths),
  ]);

  const signed = rows.map((p) => {
    const isVideo = p.media_type === "video";
    const url = isVideo ? videoByPath.get(p.storage_path) : undefined;
    return {
      id: p.id,
      storage_path: p.storage_path,
      is_primary: !!p.is_primary,
      kind: (isVideo ? "video" : "image") as "image" | "video",
      // For a video, the thumb and full URL are the same streamed object.
      thumbUrl: isVideo ? url : thumbByPath.get(p.storage_path),
      fullUrl: isVideo ? url : fullByPath.get(p.storage_path),
    };
  });

  const uploadPhoto = uploadStagePhotoAction.bind(null, stageId);
  const attachVideo = attachStageVideoAction.bind(null, stageId);

  const photoCount = imagePaths.length;
  const videoCount = videoPaths.length;
  const subtitle =
    videoCount > 0
      ? `${photoCount} photo${photoCount === 1 ? "" : "s"} · ${videoCount} video${videoCount === 1 ? "" : "s"}`
      : `${photoCount} photo${photoCount === 1 ? "" : "s"}`;

  return (
    <CollapsibleSection
      id={`stage-${stageId}-photos`}
      title="Photos"
      subtitle={subtitle}
      defaultOpen
    >
      <StagePhotoUploader
        action={uploadPhoto}
        videoAction={attachVideo}
        stageId={stageId}
      />
      <StagePhotoGrid
        stageId={stageId}
        canEditPrimary
        photos={signed
          .filter((p) => p.thumbUrl && p.fullUrl)
          .map((p) => ({
            id: p.id,
            kind: p.kind,
            thumbUrl: p.thumbUrl!,
            fullUrl: p.fullUrl!,
            isPrimary: p.is_primary,
            deleteAction: deleteStagePhotoAction.bind(null, p.id, stageId),
          }))}
      />
    </CollapsibleSection>
  );
}

/**
 * Lightweight placeholder rendered by Suspense while the photos
 * section loads. Mirrors the open CollapsibleSection shape (header
 * pill + body card) so the page doesn't shift when it streams in.
 */
export function StagePhotosFallback() {
  return (
    <div className="group">
      <div className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900 border rounded-xl shadow-sm px-4 sm:px-5 py-3.5 rounded-b-none border-b-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-50 text-brand ring-1 ring-amber-100" />
          <div className="min-w-0">
            <div className="h-4 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            <div className="h-3 w-16 bg-slate-100 dark:bg-slate-800 rounded animate-pulse mt-1.5" />
          </div>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-900 border border-t-0 rounded-b-xl px-4 sm:px-5 py-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className="aspect-[4/3] rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
