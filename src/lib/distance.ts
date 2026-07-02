import { type Coords } from "./geocode";

/** The shop. Distance is reported as miles from this point. */
export const BARN_ADDRESS = "6135 Rio Linda Blvd, Rio Linda, CA 95673";

/**
 * Hardcoded coordinates for BARN_ADDRESS (verified via Nominatim).
 *
 * Kept as a constant so distance math NEVER makes a network call on the
 * render path. Previously this geocoded the barn on first use and
 * memoized it per process — but a cold serverless worker (every deploy,
 * and Vercel recycles workers) re-ran the lookup, and a slow/throttled
 * Nominatim resolve (up to its 8s timeout) blocked the first byte of the
 * page. That was the 3-4s "hang" after saving a stage edit, since the
 * post-save redirect waits on the destination's shell render.
 *
 * Override per-deployment with BARN_LAT / BARN_LNG env vars if the shop
 * ever relocates.
 */
const BARN_COORDS: Coords = (() => {
  const lat = Number(process.env.BARN_LAT);
  const lng = Number(process.env.BARN_LNG);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return { lat: 38.6792706, lng: -121.456967 };
})();

/**
 * Barn coordinates — synchronous and network-free. Returns a plain
 * value (callers may still `await` it harmlessly).
 */
export function getBarnCoords(): Coords {
  return BARN_COORDS;
}

/**
 * Great-circle (straight-line) distance in miles between two
 * lat/lng points. Driving distance will always be longer — we label
 * the UI accordingly.
 */
export function haversineMiles(a: Coords, b: Coords): number {
  const R = 3958.7613; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
