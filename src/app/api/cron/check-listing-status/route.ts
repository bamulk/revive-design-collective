import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchListingStatus,
  isPendingLikeStatus,
} from "@/lib/property-lookup";

/**
 * Daily cron — refreshes the Zillow listing status on every still-
 * staged job with a zillow_url on file. The status is written to
 * stages.listing_status and surfaced on the dashboard's "Pending
 * listings" section (no email anymore — the dashboard shows it
 * directly).
 *
 * Auth via CRON_SECRET. Rate-limit-friendly: 750 ms between RapidAPI
 * calls so we don't burst the upstream.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  if (!process.env.RAPIDAPI_KEY) {
    return NextResponse.json(
      { ok: false, error: "RAPIDAPI_KEY not set" },
      { status: 500 },
    );
  }

  const supabase = createAdminClient();
  // No more "already notified" gate — we want to keep refreshing the
  // status daily so the dashboard reflects the current state (a row
  // can transition back from PENDING to FOR_SALE if a deal falls
  // through, etc.).
  const { data: stages, error } = await supabase
    .from("stages")
    .select("id, address, zillow_url")
    .eq("status", "staged")
    .eq("listing_monitor", true)
    .not("zillow_url", "is", null);

  if (error) {
    console.error("[cron/check-listing-status] query error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  let checked = 0;
  let pending = 0;
  let firstTimePending = 0;
  let failed = 0;

  for (const s of (stages ?? []) as any[]) {
    const status = await fetchListingStatus(s.zillow_url as string);
    checked += 1;
    const checkedAt = new Date().toISOString();

    if (!status) {
      // Stamp the check timestamp so we know we tried.
      await supabase
        .from("stages")
        .update({ listing_status_checked_at: checkedAt })
        .eq("id", s.id);
      failed += 1;
      await sleep(750);
      continue;
    }

    const triggered = isPendingLikeStatus(status);
    const patch: Record<string, unknown> = {
      listing_status: status,
      listing_status_checked_at: checkedAt,
    };
    if (triggered) {
      pending += 1;
      // Stamp first-time pending detection for diagnostics. Doesn't
      // gate anything anymore — the dashboard reads listing_status
      // directly.
      const { data: pre } = await supabase
        .from("stages")
        .select("listing_pending_notified_at")
        .eq("id", s.id)
        .single();
      if (!pre?.listing_pending_notified_at) {
        patch.listing_pending_notified_at = checkedAt;
        firstTimePending += 1;
      }
    } else {
      // Clear the first-pending timestamp if the listing came back
      // off contract, so the next time it goes pending we know.
      patch.listing_pending_notified_at = null;
    }
    await supabase.from("stages").update(patch).eq("id", s.id);

    await sleep(750);
  }

  return NextResponse.json({
    ok: true,
    checked,
    pending,
    firstTimePending,
    failed,
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
