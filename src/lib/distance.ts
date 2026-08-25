import { type Coords } from "./geocode";

/** The warehouse. Distance is reported as miles from this point. */
export const WAREHOUSE_ADDRESS = "8160 14th Ave Suite D, Sacramento, CA 95826";

/**
 * Hardcoded coordinates for WAREHOUSE_ADDRESS (verified via Nominatim).
 *
 * Kept as a constant so distance math NEVER makes a network call on the
 * render path. Previously this geocoded the warehouse on first use and
 * memoized it per process — but a cold serverless worker (every deploy,
 * and Vercel recycles workers) re-ran the lookup, and a slow/throttled
 * Nominatim resolve (up to its 8s timeout) blocked the first byte of the
 * page. That was the 3-4s "hang" after saving a stage edit, since the
 * post-save redirect waits on the destination's shell render.
 *
 * Override per-deployment with WAREHOUSE_LAT / WAREHOUSE_LNG env vars if the shop
 * ever relocates.
 */
const WAREHOUSE_COORDS: Coords = (() => {
  const lat = Number(process.env.WAREHOUSE_LAT);
  const lng = Number(process.env.WAREHOUSE_LNG);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  // 8160 14th Ave Suite D, Sacramento, CA 95826 (verified via Nominatim).
  return { lat: 38.5394904, lng: -121.4063463 };
})();

/**
 * Warehouse coordinates — synchronous and network-free. Returns a plain
 * value (callers may still `await` it harmlessly).
 */
export function getWarehouseCoords(): Coords {
  return WAREHOUSE_COORDS;
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
