import { NextRequest, NextResponse } from "next/server";
import { runPhotoReminderCheck } from "@/lib/notify";

/**
 * Daily cron endpoint — texts admins about scheduled stages 3 days
 * out that have zero photos uploaded.
 *
 * Vercel-cron requirements:
 * - Vercel signs each cron request with the `CRON_SECRET` env var.
 *   We verify it via the Authorization header so random visitors
 *   can't trigger SMS by hitting this URL.
 * - Schedule lives in vercel.json (see `crons` array).
 */
export async function GET(req: NextRequest) {
  // Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await runPhotoReminderCheck();
  console.log("[cron/reminders]", result);
  return NextResponse.json({ ok: true, ...result });
}
