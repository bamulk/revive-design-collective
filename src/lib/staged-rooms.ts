/**
 * The rooms / areas a stage covers. Picked as checkboxes on the stage
 * form and stored on stages.staged_rooms as a jsonb array of
 * { key, qty } — e.g. [{ "key": "bedrooms", "qty": 3 }].
 *
 * Countable rooms (bedrooms, outdoor areas) render a quantity picker and
 * print as "3 bedrooms"; the rest are simple checkboxes printing their
 * plain label.
 *
 * Keys are stable — change a label freely, but renaming a key orphans
 * the selections already saved against it.
 */
export const STAGED_ROOMS = [
  { key: "living_room", label: "Living room", countable: false, defaultQty: 1 },
  { key: "dining_room", label: "Dining room", countable: false, defaultQty: 1 },
  { key: "den", label: "Den", countable: false, defaultQty: 1 },
  { key: "kitchen", label: "Kitchen", countable: false, defaultQty: 1 },
  { key: "bedrooms", label: "Bedrooms", countable: true, defaultQty: 3 },
  { key: "bathrooms", label: "Bathrooms", countable: false, defaultQty: 1 },
  { key: "outdoor", label: "Outdoor areas", countable: true, defaultQty: 2 },
  { key: "guesthouse", label: "Guesthouse", countable: false, defaultQty: 1 },
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
    const clamped = def.countable
      ? Math.min(MAX_QTY, Math.max(1, Math.round(qty) || def.defaultQty))
      : 1;
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
    if (!def.countable) return def.label;
    return `${qty} ${def.label.toLowerCase()}`;
  });
}

/** One-line scope summary for the contract / invoice, or null if none. */
export function stagedRoomsSummary(raw: unknown): string | null {
  const labels = stagedRoomLabels(raw);
  if (labels.length === 0) return null;
  return `Rooms staged: ${labels.join(", ")}.`;
}
