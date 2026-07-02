import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lookupProperty } from "@/lib/property-lookup";

/**
 * GET /api/property-lookup?address=...&city=...
 * Returns property details (sqft, beds, baths, photos) from Zillow via RapidAPI.
 * State is hardcoded to CA — no need to pass it.
 * Protected — requires authenticated user.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const address = req.nextUrl.searchParams.get("address")?.trim();
  const city = req.nextUrl.searchParams.get("city")?.trim() ?? "";

  if (!address) {
    return NextResponse.json(
      { error: "address is required" },
      { status: 400 },
    );
  }

  const data = await lookupProperty(address, city);
  if (!data) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({ found: true, ...data });
}
