// Geocoding pipeline. Two providers, fallback order:
//
//   1. OpenStreetMap Nominatim (free, no key, 1 req/sec).
//      Great for major streets, weak for newer subdivisions in
//      growing suburbs like Rocklin / Lincoln / Roseville.
//   2. Google Geocoding API (~$5 / 1,000 requests, comprehensive).
//      Used only when Nominatim returns nothing and a server-side
//      API key is set in GOOGLE_GEOCODING_API_KEY.
//
// Provider 2 is opt-in so existing deployments without a Google key
// continue to work — they just miss the newer-subdivision addresses
// the same way they did before.

export type Coords = { lat: number; lng: number };

// Per-process memoization. Useful for the barn address (called from
// every stage page) and for repeated geocodes of the same string in
// a single request lifecycle.
const cache = new Map<string, Coords | null>();

async function nominatim(q: string): Promise<Coords | null> {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0&q=" +
    encodeURIComponent(q);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "revive-design-collective-app/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as { lat?: string; lon?: string }[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const lat = Number(arr[0].lat);
    const lng = Number(arr[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

async function google(q: string): Promise<Coords | null> {
  const key = process.env.GOOGLE_GEOCODING_API_KEY?.trim();
  if (!key) return null;
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?address=" +
    encodeURIComponent(q) +
    "&key=" +
    encodeURIComponent(key);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      status?: string;
      results?: { geometry?: { location?: { lat: number; lng: number } } }[];
      error_message?: string;
    };
    if (data.status !== "OK") {
      if (data.error_message) {
        console.warn(`[geocode] Google ${data.status}: ${data.error_message}`);
      }
      return null;
    }
    const loc = data.results?.[0]?.geometry?.location;
    if (!loc) return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}

export async function geocodeAddress(
  address: string,
): Promise<Coords | null> {
  const q = address.trim();
  if (!q) return null;
  if (cache.has(q)) return cache.get(q) ?? null;

  // Nominatim first (free), Google as fallback.
  let coords = await nominatim(q);
  if (!coords) coords = await google(q);

  cache.set(q, coords);
  return coords;
}

/**
 * Reverse-geocode lat/lng → a "general area" label (suburb /
 * neighbourhood / quarter / city_district) plus the resolved city,
 * using the free Nominatim reverse endpoint. The city is returned so
 * callers can sanity-check it against the stage's city before storing
 * the neighborhood — a city-less stage with bad cached coords would
 * otherwise get a neighborhood from the wrong metro.
 */
export async function reverseGeocodeArea(
  lat: number,
  lng: number,
): Promise<{ neighborhood: string | null; city: string | null }> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=json` +
    `&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "revive-design-collective-app/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { neighborhood: null, city: null };
    const data = (await res.json()) as { address?: Record<string, string> };
    const a = data.address ?? {};
    const neighborhood =
      a.suburb || a.neighbourhood || a.quarter || a.city_district || null;
    const city = a.city || a.town || a.village || a.hamlet || null;
    return { neighborhood, city };
  } catch {
    return { neighborhood: null, city: null };
  }
}
