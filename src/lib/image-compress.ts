"use client";

/**
 * Client-side image preprocessing for photo uploads.
 *
 * - Converts HEIC/HEIF (common from iPhone uploads via Files / desktop) to JPEG
 * - Resizes so the longest edge is at most `maxDim` (default 1920)
 * - Re-encodes as JPEG at the given quality (default 0.82)
 *
 * iPhone photos are ~3–5 MB. After this pass they're typically 250–600 KB
 * with no visible quality loss for property documentation, and they upload
 * way faster from spotty job-site cell signal.
 *
 * If anything fails (unreadable image, etc.) we return the original file so
 * the upload still succeeds — the user shouldn't lose their photo to a
 * client-side bug.
 */
export async function compressImage(
  file: File,
  opts: { maxDim?: number; quality?: number } = {}
): Promise<File> {
  const maxDim = opts.maxDim ?? 1920;
  const quality = opts.quality ?? 0.82;

  try {
    let working: Blob = file;

    // HEIC / HEIF conversion. iOS Safari/Chrome usually auto-convert HEIC
    // to JPEG when uploading via <input>, but Mac/Files-app uploads come
    // through as HEIC, which canvas can't decode.
    const isHeic =
      /image\/heic|image\/heif/i.test(file.type) ||
      /\.heic$|\.heif$/i.test(file.name);
    if (isHeic) {
      const heic2any = (await import("heic2any")).default as (args: {
        blob: Blob;
        toType?: string;
        quality?: number;
      }) => Promise<Blob | Blob[]>;
      const converted = await heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.9,
      });
      working = Array.isArray(converted) ? converted[0] : converted;
    }

    // Resize via canvas. createImageBitmap handles EXIF orientation
    // automatically on modern browsers (imageOrientation: "from-image").
    const bitmap = await createImageBitmap(working, {
      imageOrientation: "from-image",
    });
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxDim ? maxDim / longest : 1;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        quality
      )
    );

    // Always end up with a .jpg name + type so the server pipeline doesn't
    // get confused by a `foo.heic` file whose contents are actually JPEG.
    const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
    const out = new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });

    // If the "compressed" file is somehow larger than the original (rare,
    // e.g. tiny screenshots), keep whichever is smaller.
    return out.size < file.size ? out : file;
  } catch (err) {
    console.warn("compressImage failed, using original:", err);
    return file;
  }
}
