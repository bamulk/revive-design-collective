/**
 * Property data lookup using:
 *   1. Zillow free autocomplete → get zpid + build Zillow URL
 *   2. RapidAPI "Zillow.com Live Data Scraper" /byurl → get beds/baths/sqft/photos
 *
 * Works for ALL properties (listed, sold, off-market).
 * Hardcoded for California (Sacramento area).
 */

const RAPIDAPI_HOST = "zillow-com-live-data-scraper-api.p.rapidapi.com";

export interface PropertyData {
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  photos: string[];
  propertyType: string | null;
  price: number | null;
  status: string | null;
  zillowUrl: string | null;
  /** City resolved by the Zillow autocomplete (used to auto-fill the form). */
  city: string | null;
  /** ZIP resolved alongside city. */
  zipCode: string | null;
}

/**
 * Step 1: Use Zillow's free autocomplete to resolve an address to a zpid.
 * No API key needed — this is a public endpoint.
 */
async function resolveZpid(
  address: string,
  city: string,
  state: string,
): Promise<{
  zpid: number;
  url: string;
  city: string | null;
  zipCode: string | null;
} | null> {
  const query = [address, city, state].filter(Boolean).join(" ");
  const url = new URL(
    "https://www.zillowstatic.com/autocomplete/v3/suggestions",
  );
  url.searchParams.set("q", query);
  url.searchParams.set("resultTypes", "allAddress");

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;

    const json = await res.json();
    const results: any[] = json?.results ?? [];

    // Find an address-type result with a zpid.
    for (const r of results) {
      const meta = r?.metaData;
      if (!meta?.zpid) continue;

      // Validate it's in the right state.
      if (state && meta.state?.toUpperCase() !== state.toUpperCase()) continue;

      const zilUrl =
        `https://www.zillow.com/homedetails/` +
        `${meta.streetNumber}-${meta.streetName?.replace(/\s+/g, "-")}-` +
        `${meta.city?.replace(/\s+/g, "-")}-${meta.state}-${meta.zipCode}/` +
        `${meta.zpid}_zpid/`;

      return {
        zpid: meta.zpid,
        url: zilUrl,
        city: meta.city ?? null,
        zipCode: meta.zipCode ?? null,
      };
    }
    return null;
  } catch (err) {
    console.error("[property-lookup] autocomplete error:", err);
    return null;
  }
}

/**
 * Step 2: Get property details from RapidAPI using the Zillow URL.
 */
async function getPropertyByUrl(
  zillowUrl: string,
  originalZillowUrl: string,
  resolvedCity: string | null = null,
  resolvedZip: string | null = null,
): Promise<PropertyData | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    console.warn("[property-lookup] RAPIDAPI_KEY not set");
    return null;
  }

  const url = new URL(`https://${RAPIDAPI_HOST}/byurl`);
  url.searchParams.set("url", zillowUrl);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": RAPIDAPI_HOST,
        "x-rapidapi-key": apiKey,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[property-lookup] byurl ${res.status}: ${body}`);
      return null;
    }

    const p = await res.json();
    if (p?.error) {
      console.error(`[property-lookup] API error: ${p.error}`);
      return null;
    }

    // Build photo array — listed properties have a photo_url.
    const photos: string[] = [];
    if (p.photo_url) {
      // Upgrade to full-size image.
      const fullSize = p.photo_url.replace(/-p_[a-z]\./, "-p_f.");
      photos.push(fullSize);
    }

    return {
      sqft: p.sqft ?? null,
      bedrooms: p.beds ?? null,
      bathrooms: p.baths ?? null,
      photos,
      propertyType: p.property_type ?? null,
      price: p.price ?? null,
      status: p.status ?? null,
      zillowUrl: p.url || originalZillowUrl,
      city: p.city ?? resolvedCity,
      zipCode: p.zip_code ?? p.zipcode ?? resolvedZip,
    };
  } catch (err) {
    console.error("[property-lookup] byurl error:", err);
    return null;
  }
}

/**
 * Look up property details by street address + optional city.
 * Works for any California property — listed or not.
 */
export async function lookupProperty(
  address: string,
  city: string,
): Promise<PropertyData | null> {
  if (address.length < 5) return null;

  const state = "CA";

  console.log(`[property-lookup] resolving: "${address}, ${city}, ${state}"`);

  // Step 1: Get zpid from Zillow autocomplete (free).
  const resolved = await resolveZpid(address, city, state);
  if (!resolved) {
    console.warn("[property-lookup] address not found in Zillow autocomplete");
    return null;
  }

  console.log(
    `[property-lookup] found zpid=${resolved.zpid}, fetching details...`,
  );

  // Step 2: Get property details via RapidAPI (1 API call). Pass the
  // autocomplete-resolved city/zip through so the response includes
  // them even if the RapidAPI payload doesn't.
  const data = await getPropertyByUrl(
    resolved.url,
    resolved.url,
    resolved.city,
    resolved.zipCode,
  );
  if (!data) {
    console.warn("[property-lookup] could not fetch property details");
    return null;
  }

  console.log(
    `[property-lookup] success: ${data.bedrooms}bd/${data.bathrooms}ba, ${data.sqft}sqft`,
  );
  return data;
}

/**
 * Fetch ONLY the current listing status for a Zillow URL. Used by the
 * daily monitor cron to detect "PENDING" transitions. Cheaper than a
 * full property fetch because we don't care about beds/baths/sqft —
 * but the API doesn't expose a status-only endpoint so we still call
 * /byurl and pluck the status field. Returns null on any failure (the
 * cron skips and re-tries tomorrow).
 */
export async function fetchListingStatus(
  zillowUrl: string,
): Promise<string | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;
  const url = new URL(`https://${RAPIDAPI_HOST}/byurl`);
  url.searchParams.set("url", zillowUrl);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": RAPIDAPI_HOST,
        "x-rapidapi-key": apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(
        `[fetchListingStatus] ${res.status} for ${zillowUrl}`,
      );
      return null;
    }
    const p = await res.json();
    if (p?.error) return null;
    const raw = (p.status ?? p.home_status ?? p.homeStatus) as
      | string
      | undefined;
    return raw ? String(raw).toUpperCase() : null;
  } catch (err) {
    console.error(`[fetchListingStatus] ${zillowUrl}:`, err);
    return null;
  }
}

/**
 * Whether a Zillow status string indicates the listing has gone under
 * contract. Treat both PENDING and CONTINGENT as triggers — both mean
 * "destage is coming."
 */
export function isPendingLikeStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.toUpperCase();
  return (
    s.includes("PENDING") ||
    s.includes("CONTINGENT") ||
    s.includes("UNDER_CONTRACT")
  );
}
