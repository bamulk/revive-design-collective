/**
 * Web Push (browser notifications) sender.
 *
 * Env vars:
 *   VAPID_PUBLIC_KEY      — base64-url public key (also exposed to client)
 *   VAPID_PRIVATE_KEY     — base64-url private key (server only)
 *   VAPID_SUBJECT         — mailto: or https: URL for VAPID claims
 *                            (defaults to mailto:noreply@revivedesigncollective.com)
 *
 * Each user can have multiple subscriptions (one per device/browser),
 * stored in the `push_subscriptions` table. Failed sends with a 404 or
 * 410 status auto-delete the subscription (browser unsubscribed it).
 */

import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

let configured = false;

function configure() {
  if (configured) return;
  // Trim — Vercel sometimes stores values with trailing newlines when
  // env vars are set via `echo | vercel env add` (newline gets baked in).
  // Without trimming, web-push rejects the public key as the wrong size.
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) return;
  webpush.setVapidDetails(
    (process.env.VAPID_SUBJECT || "mailto:noreply@revivedesigncollective.com").trim(),
    pub,
    priv,
  );
  configured = true;
}

export function isPushConfigured(): boolean {
  return !!(
    process.env.VAPID_PUBLIC_KEY?.trim() &&
    process.env.VAPID_PRIVATE_KEY?.trim()
  );
}

export interface PushPayload {
  title: string;
  body: string;
  /** URL to open when the notification is clicked. */
  url?: string;
  /** Optional tag — newer notifications with the same tag replace older ones. */
  tag?: string;
}

/**
 * Send a push notification to every device subscribed by the given user.
 * Returns { sent, failed }.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  if (!isPushConfigured()) {
    console.warn("[push] not configured — skipping");
    return { sent: 0, failed: 0 };
  }
  configure();

  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subs || subs.length === 0) return { sent: 0, failed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const expiredIds: string[] = [];

  await Promise.all(
    subs.map(async (s: any) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          body,
        );
        sent += 1;
      } catch (err: any) {
        failed += 1;
        const status = err?.statusCode;
        // 404 / 410 mean the subscription is dead — purge it so the
        // table doesn't accumulate junk.
        if (status === 404 || status === 410) {
          expiredIds.push(s.id);
        } else {
          console.error("[push] send error:", err?.message ?? err);
        }
      }
    }),
  );

  if (expiredIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", expiredIds);
  }

  return { sent, failed };
}

/** Send to multiple users in parallel. */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  const results = await Promise.all(
    userIds.map((id) => sendPushToUser(id, payload)),
  );
  return results.reduce(
    (acc, r) => ({ sent: acc.sent + r.sent, failed: acc.failed + r.failed }),
    { sent: 0, failed: 0 },
  );
}
