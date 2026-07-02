import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { signTransformedUrls, type ImgTransform } from "@/lib/photo-urls";

/**
 * Cached batch thumbnail signing for list pages.
 *
 * The list pages (stages/groups, board, dashboard) sign ~800 transformed
 * thumbnail URLs per cold render — up to 800 sequential createSignedUrl
 * round-trips (concurrency 12), several seconds of latency. Storage
 * paths are IMMUTABLE (each upload is a unique `${stageId}/${ts}-${uuid}`
 * path that always points at the same bytes), so a signed URL for a path
 * is always valid for its object — safe to cache server-side across
 * requests/users.
 *
 * Signs via the admin client (no per-request cookies) so the work is
 * cacheable with unstable_cache. Keyed by bucket + transform + the exact
 * path set, so adding/removing/changing a photo (which changes the set)
 * naturally produces a fresh signing; otherwise it's a cache hit.
 */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Cached batch signing WITHOUT an image transform — for videos (and any
 * non-image media), where Supabase's resize/quality transforms don't
 * apply and would fail. Uses the plain batch `createSignedUrls` API
 * (one round-trip). Same immutable-path caching rationale as
 * signThumbsCached.
 */
export async function signPlainCached(
  bucket: string,
  paths: string[],
  {
    expiresIn = 86400,
    revalidate = 3600,
  }: { expiresIn?: number; revalidate?: number } = {},
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean))).sort();
  if (unique.length === 0) return new Map();

  const setKey = `${bucket}:plain:${unique.length}:${djb2(unique.join("|"))}`;

  const load = unstable_cache(
    async (): Promise<[string, string][]> => {
      const admin = createAdminClient();
      const { data } = await admin.storage
        .from(bucket)
        .createSignedUrls(unique, expiresIn);
      const out: [string, string][] = [];
      for (const row of data ?? []) {
        if (row.signedUrl && row.path) out.push([row.path, row.signedUrl]);
      }
      return out;
    },
    ["sign-plain", setKey],
    { revalidate, tags: ["stage-thumbs"] },
  );

  return new Map(await load());
}

export async function signThumbsCached(
  bucket: string,
  paths: string[],
  transform: ImgTransform,
  {
    expiresIn = 86400,
    revalidate = 3600,
  }: { expiresIn?: number; revalidate?: number } = {},
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean))).sort();
  if (unique.length === 0) return new Map();

  const tkey = `${transform.width ?? 0}x${transform.height ?? 0}q${transform.quality ?? 0}r${transform.resize ?? ""}`;
  const setKey = `${bucket}:${tkey}:${unique.length}:${djb2(unique.join("|"))}`;

  const load = unstable_cache(
    async (): Promise<[string, string][]> => {
      const admin = createAdminClient();
      const map = await signTransformedUrls(
        admin as unknown as Parameters<typeof signTransformedUrls>[0],
        bucket,
        unique,
        transform,
        { expiresIn },
      );
      return Array.from(map.entries());
    },
    ["sign-thumbs", setKey],
    { revalidate, tags: ["stage-thumbs"] },
  );

  return new Map(await load());
}
