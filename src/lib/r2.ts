/**
 * Cloudflare R2 storage for stage VIDEOS.
 *
 * Supabase Storage caps uploads at the project-wide limit (50 MB on the
 * Free plan), which phone videos routinely exceed. R2's free tier allows
 * far larger objects and charges no egress, so videos go there while
 * photos stay in Supabase (the image-transform thumbnail pipeline
 * depends on Supabase).
 *
 * Optional: with the env vars unset, isR2Configured() is false and the
 * app falls back to uploading videos to Supabase as before.
 *
 * Required env (server-only):
 *   R2_ACCOUNT_ID         - Cloudflare account id
 *   R2_ACCESS_KEY_ID      - R2 API token access key
 *   R2_SECRET_ACCESS_KEY  - R2 API token secret
 *   R2_BUCKET             - bucket name
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Stored in stage_photos.storage_path so playback knows where to look. */
export const R2_PREFIX = "r2:";

export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  );
}

/** True for a storage_path that lives in R2 rather than Supabase. */
export function isR2Path(storagePath: string): boolean {
  return storagePath.startsWith(R2_PREFIX);
}

/** Strip the marker to get the raw object key. */
export function r2Key(storagePath: string): string {
  return storagePath.startsWith(R2_PREFIX)
    ? storagePath.slice(R2_PREFIX.length)
    : storagePath;
}

function client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

/**
 * Presigned PUT the browser uploads to directly — the bytes never pass
 * through our server (Vercel caps a request body at ~4.5 MB).
 */
export async function presignUpload(
  key: string,
  contentType: string,
  expiresIn = 60 * 10,
): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn },
  );
}

/** Short-lived playback URL for a stored object. */
export async function presignDownload(
  key: string,
  expiresIn = 60 * 60,
): Promise<string> {
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
    }),
    { expiresIn },
  );
}

/** Best-effort delete (used when a metadata row is removed/rolled back). */
export async function deleteR2Object(key: string): Promise<void> {
  await client().send(
    new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }),
  );
}

/** Sign many keys at once, returning a path -> url map. */
export async function presignDownloadMany(
  storagePaths: string[],
  expiresIn = 60 * 60,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!isR2Configured() || storagePaths.length === 0) return out;
  await Promise.all(
    storagePaths.map(async (p) => {
      try {
        out.set(p, await presignDownload(r2Key(p), expiresIn));
      } catch (e) {
        console.error("[r2] presign failed for", p, e);
      }
    }),
  );
  return out;
}
