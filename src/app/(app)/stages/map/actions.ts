"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geocode";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Geocode up to 30 active stages that don't have lat/lng yet.
 * Nominatim asks for ~1 req/sec, so this loops with a 1.1s delay
 * between addresses. With a 30-row cap each call takes ~33 seconds
 * — safely under Vercel's serverless timeout (60s on Hobby).
 *
 * Returns { processed, found } so the UI can tell the user how many
 * landed. Re-run the action a few times to drain the backlog.
 */
export async function bulkGeocodeStagesAction(): Promise<{
  processed: number;
  found: number;
}> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("stages")
    .select("id, address, city")
    .neq("status", "estimate")
    .neq("status", "cancelled")
    .neq("status", "completed")
    .is("lat", null)
    .order("created_at", { ascending: false })
    .limit(30);

  if (!rows || rows.length === 0) {
    return { processed: 0, found: 0 };
  }

  let found = 0;
  for (const row of rows as Array<{
    id: string;
    address: string;
    city: string | null;
  }>) {
    const base = row.city ? `${row.address}, ${row.city}` : row.address;
    // Default to CA if not already in the query.
    const query = /,\s*[A-Z]{2}\b/.test(base) ? base : `${base}, CA`;
    const coords = await geocodeAddress(query);
    if (coords) {
      await supabase
        .from("stages")
        .update({ lat: coords.lat, lng: coords.lng })
        .eq("id", row.id);
      found += 1;
    }
    // Polite spacing — Nominatim's policy is 1 req/sec.
    await new Promise((r) => setTimeout(r, 1100));
  }

  revalidatePath("/stages/map");
  return { processed: rows.length, found };
}
