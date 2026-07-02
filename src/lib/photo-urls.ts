/**
 * Helpers for serving stage photos at the right size.
 *
 * Egress was maxing out the Supabase plan because every thumbnail —
 * dashboard cards, the stages board, group cards, the stage photo grid
 * — was serving the FULL ~400 KB original even when displayed at a few
 * hundred pixels. On the Pro plan we can use Storage image
 * transformations to resize/recompress on the fly (rendered once, then
 * CDN-cached), which cuts thumbnail egress by ~95%.
 *
 * The batch `createSignedUrls` API does NOT accept a transform, so for
 * transformed URLs we fall back to concurrent singular `createSignedUrl`
 * calls. Signing is a cheap metadata operation (no image bytes move —
 * the transform compute happens lazily on first fetch and is then
 * cached at the CDN), so concurrent signing is comparable to the batch
 * call in wall-clock time. Concurrency is capped so a page listing
 * hundreds of stages doesn't fire hundreds of simultaneous requests.
 */

export type ImgTransform = {
  width?: number;
  height?: number;
  resize?: "cover" | "contain" | "fill";
  quality?: number;
};

/** Small square-ish thumbnail for cards and grids. */
export const THUMB: ImgTransform = {
  width: 400,
  height: 400,
  resize: "cover",
  quality: 55,
};

/** Capped full-size image for the lightbox — big enough to look sharp,
 *  far smaller than a raw original. */
export const FULL: ImgTransform = {
  width: 1920,
  quality: 80,
};

// Minimal structural type so we don't have to import the full Supabase
// client generic here.
type StorageCapable = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
        options?: { transform?: ImgTransform },
      ) => Promise<{
        data: { signedUrl: string } | null;
        error: unknown;
      }>;
    };
  };
};

/**
 * Sign a list of storage paths, each with the same image transform.
 * Returns a Map keyed by the original path → signed (transformed) URL.
 * Paths that fail to sign are simply omitted.
 */
export async function signTransformedUrls(
  supabase: StorageCapable,
  bucket: string,
  paths: string[],
  transform: ImgTransform,
  {
    expiresIn = 86400,
    concurrency = 12,
  }: { expiresIn?: number; concurrency?: number } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return out;

  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const path = unique[cursor++];
      try {
        const { data } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, expiresIn, { transform });
        if (data?.signedUrl) out.set(path, data.signedUrl);
      } catch {
        // Skip unsignable paths — caller falls back to "No photo".
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, unique.length) },
    worker,
  );
  await Promise.all(workers);
  return out;
}
