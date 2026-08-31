/**
 * The rooms / areas a stage covers. Picked as checkboxes on the stage
 * form and stored on stages.staged_rooms as a jsonb array of
 * { key, qty } — e.g. [{ "key": "bedrooms", "qty": 3 }].
 *
 * Every room carries a quantity — large houses may have several of any
 * of them. One prints as a plain name ("Living room"), more than one
 * takes the count and the plural ("3 bedrooms").
 *
 * Keys are stable — change a label freely, but renaming a key orphans
 * the selections already saved against it.
 */
export const STAGED_ROOMS = [
  { key: "living_room", label: "Living room", singular: "living room", plural: "living rooms", defaultQty: 1 },
  { key: "dining_room", label: "Dining room", singular: "dining room", plural: "dining rooms", defaultQty: 1 },
  { key: "den", label: "Den", singular: "den", plural: "dens", defaultQty: 1 },
  { key: "kitchen", label: "Kitchen", singular: "kitchen", plural: "kitchens", defaultQty: 1 },
  { key: "bedrooms", label: "Bedrooms", singular: "bedroom", plural: "bedrooms", defaultQty: 3 },
  { key: "bathrooms", label: "Bathrooms", singular: "bathroom", plural: "bathrooms", defaultQty: 1 },
  { key: "outdoor", label: "Outdoor areas", singular: "outdoor area", plural: "outdoor areas", defaultQty: 2 },
  { key: "guesthouse", label: "Guesthouse", singular: "guesthouse", plural: "guesthouses", defaultQty: 1 },
] as const;

export type StagedRoomKey = (typeof STAGED_ROOMS)[number]["key"];
export type StagedRoom = { key: string; qty: number };

const BY_KEY = new Map(STAGED_ROOMS.map((r) => [r.key as string, r]));

/** Pre-quantity keys, so anything saved by the first version still reads. */
const LEGACY_KEYS: Record<string, { key: string; qty: number }> = {
  bedrooms_3: { key: "bedrooms", qty: 3 },
  outdoor_2: { key: "outdoor", qty: 2 },
};

const MAX_QTY = 20;

/**
 * Sanitize the saved value (jsonb) or the JSON string the form posts.
 * Accepts both the current [{key, qty}] shape and the original array of
 * plain keys. Unknown keys are dropped, quantities clamped, duplicates
 * merged, and the result returned in catalog order.
 */
export function parseStagedRooms(raw: unknown): StagedRoom[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];

  const byKey = new Map<string, number>();
  for (const item of arr) {
    let key: string | null = null;
    let qty = 1;
    if (typeof item === "string") {
      key = item;
    } else if (item && typeof item === "object") {
      const k = (item as { key?: unknown }).key;
      const q = Number((item as { qty?: unknown }).qty);
      if (typeof k === "string") key = k;
      if (Number.isFinite(q)) qty = q;
    }
    if (!key) continue;
    const legacy = LEGACY_KEYS[key];
    if (legacy) {
      key = legacy.key;
      if (qty <= 1) qty = legacy.qty;
    }
    const def = BY_KEY.get(key);
    if (!def) continue;
    const clamped = Math.min(
      MAX_QTY,
      Math.max(1, Math.round(qty) || def.defaultQty),
    );
    byKey.set(key, clamped);
  }

  // Catalog order, not click order, so documents read consistently.
  return STAGED_ROOMS.filter((r) => byKey.has(r.key)).map((r) => ({
    key: r.key as string,
    qty: byKey.get(r.key)!,
  }));
}

/**
 * Display labels for the saved rooms, in catalog order — countable rooms
 * are prefixed with their quantity ("3 bedrooms"), the rest print plain
 * ("Living room").
 */
export function stagedRoomLabels(raw: unknown): string[] {
  return parseStagedRooms(raw).map(({ key, qty }) => {
    const def = BY_KEY.get(key)!;
    // One reads as a plain name ("Living room"); more than one takes the
    // count and the plural ("3 bedrooms").
    if (qty === 1) {
      return def.singular.charAt(0).toUpperCase() + def.singular.slice(1);
    }
    return `${qty} ${def.plural}`;
  });
}

/** One-line scope summary for the contract / invoice, or null if none. */
export function stagedRoomsSummary(raw: unknown): string | null {
  const labels = stagedRoomLabels(raw);
  if (labels.length === 0) return null;
  return `Rooms staged: ${labels.join(", ")}.`;
}
