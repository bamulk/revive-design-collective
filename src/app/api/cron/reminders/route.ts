import { NextRequest, NextResponse } from "next/server";
import { runPhotoReminderCheck } from "@/lib/notify";
import { runPaymentReminderCheck } from "@/lib/payment-reminders";
import { runUnsignedContractCheck } from "@/lib/unsigned-alerts";

/**
 * Daily cron endpoint — two reminder sweeps in one run (Vercel cron
 * slots are limited per plan, so new dailies piggyback here):
 *
 * 1. Photo nag: push admins about scheduled stages 3 days out that
 *    have zero photos uploaded.
 * 2. Payment reminders: email clients whose stage/extension invoices
 *    are unpaid — one email per (client, secondary recipient) pair so a
 *    CC'd party never sees another transaction's invoice; first nudge
 *    ~5 days after the invoice email, then every 3 days (see
 *    src/lib/payment-reminders.ts for the skip rules and safety valves).
 * 3. Unsigned-agreement alert: email admins about stages staging
 *    TOMORROW whose agreement isn't signed — unsigned stages never get
 *    invoiced, so these used to slip through silently.
 *
 * Each pass runs in its own try/catch so a failure in one never
 * silently cancels the other.
 *
 * Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>`. This route
 * FAILS CLOSED — if CRON_SECRET isn't set in the environment, it
 * refuses to run rather than letting anonymous GETs trigger real
 * client-facing billing email. (Set CRON_SECRET in Vercel env vars.)
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error(
      "[cron/reminders] CRON_SECRET is not set — refusing to run (fail closed).",
    );
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let photos: unknown = null;
  let photosError: string | null = null;
  try {
    photos = await runPhotoReminderCheck();
  } catch (e: any) {
    photosError = e?.message || "photo pass failed";
    console.error("[cron/reminders] photo pass failed:", e);
  }

  let payments: unknown = null;
  let paymentsError: string | null = null;
  try {
    payments = await runPaymentReminderCheck();
  } catch (e: any) {
    paymentsError = e?.message || "payment pass failed";
    console.error("[cron/reminders] payment pass failed:", e);
  }

  let unsigned: unknown = null;
  let unsignedError: string | null = null;
  try {
    unsigned = await runUnsignedContractCheck();
  } catch (e: any) {
    unsignedError = e?.message || "unsigned pass failed";
    console.error("[cron/reminders] unsigned pass failed:", e);
  }

  console.log("[cron/reminders]", {
    photos,
    photosError,
    payments,
    paymentsError,
    unsigned,
    unsignedError,
  });
  return NextResponse.json({
    ok: !photosError && !paymentsError && !unsignedError,
    photos,
    photosError,
    payments,
    paymentsError,
    unsigned,
    unsignedError,
  });
}
