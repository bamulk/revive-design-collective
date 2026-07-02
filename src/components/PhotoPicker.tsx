"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X, Loader2 } from "lucide-react";
import { compressImage } from "@/lib/image-compress";

/**
 * Multi-photo picker with live thumbnails. Submits files as `photos` (repeated
 * field) so the server action can read them with `formData.getAll("photos")`.
 *
 * Each picked file is compressed client-side (HEIC → JPEG, resized to a max
 * 1920px edge, re-encoded at q≈0.82) before being added to the form. That
 * trades a few hundred ms of work for ~85% smaller uploads.
 *
 * We keep files in React state and drive a hidden <input name="photos"> via a
 * DataTransfer so user-removed files don't get submitted.
 */
export default function PhotoPicker({
  name = "photos",
  label = "Photos",
}: {
  name?: string;
  label?: string;
}) {
  const hiddenRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [processing, setProcessing] = useState(0);

  // Sync the hidden input that actually gets submitted with `files`.
  useEffect(() => {
    if (!hiddenRef.current) return;
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    hiddenRef.current.files = dt.files;
  }, [files]);

  // Object URLs for previews; revoke on change/unmount.
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    e.target.value = ""; // allow re-picking same file later

    setProcessing((n) => n + picked.length);
    // Compress in parallel — modern phones handle 3–5 concurrent canvas
    // operations fine, and the user gets thumbnails sooner.
    const compressed = await Promise.all(picked.map((f) => compressImage(f)));
    setProcessing((n) => Math.max(0, n - picked.length));

    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const f of compressed) {
        const k = `${f.name}:${f.size}`;
        if (!seen.has(k)) {
          merged.push(f);
          seen.add(k);
        }
      }
      return merged;
    });
  }

  function remove(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const totalKb = Math.round(totalBytes / 1024);

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</div>

      {/* Hidden input the form actually submits */}
      <input ref={hiddenRef} type="file" name={name} multiple className="hidden" />

      <label
        htmlFor={`${name}_visible`}
        className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-4 text-sm text-slate-600 dark:text-slate-400 cursor-pointer hover:border-brand hover:bg-amber-50/40 transition"
      >
        {processing > 0 ? (
          <>
            <Loader2 size={16} className="animate-spin text-brand" />
            Optimizing {processing}…
          </>
        ) : (
          <>
            <Camera size={16} className="text-slate-500 dark:text-slate-400" />
            Tap to add photos
          </>
        )}
      </label>
      {/* `capture="environment"` was forcing the camera on mobile.
          Dropping it lets iOS / Android show the native Photos picker
          *and* a "Take Photo" option so the user can choose either. */}
      <input
        id={`${name}_visible`}
        type="file"
        accept="image/*,image/heic,image/heif"
        multiple
        onChange={onPick}
        className="hidden"
      />

      {files.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {files.length} photo{files.length === 1 ? "" : "s"} ·{" "}
          {totalKb < 1024 ? `${totalKb} KB` : `${(totalKb / 1024).toFixed(1)} MB`}{" "}
          total
        </p>
      )}

      {previews.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {previews.map((url, i) => (
            <div
              key={url}
              className="relative group rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-full h-24 object-cover" />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove photo"
                className="absolute top-1 right-1 w-7 h-7 inline-flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
