/**
 * The rooms / areas a stage can cover. Picked as checkboxes on the stage
 * form and stored on stages.staged_rooms (jsonb array of keys).
 *
 * Keys are stable — change a label freely, but renaming a key orphans
 * the selections already saved against it.
 */
export const STAGED_ROOMS = [
  { key: "living_room", label: "Living room" },
  { key: "dining_room", label: "Dining room" },
  { key: "den", label: "Den" },
  { key: "kitchen", label: "Kitchen" },
  { key: "bedrooms_3", label: "3 bedrooms" },
  { key: "bathrooms", label: "Bathrooms" },
  { key: "outdoor_2", label: "2 outdoor area" },
  { key: "guesthouse", label: "Guesthouse" },
] as const;

export type StagedRoomKey = (typeof STAGED_ROOMS)[number]["key"];

const VALID = new Set(STAGED_ROOMS.map((r) => r.key as string));

/**
 * Sanitize the saved value (jsonb array) or the JSON string the form's
 * hidden field posts. Drops anything not in the catalog, de-dupes, and
 * always returns a safe array in catalog order.
 */
export function parseStagedRooms(raw: unknown): string[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const picked = new Set(
    arr.filter((k): k is string => typeof k === "string" && VALID.has(k)),
  );
  // Catalog order, not click order, so documents read consistently.
  return STAGED_ROOMS.map((r) => r.key as string).filter((k) => picked.has(k));
}

/** Human-readable labels for the saved keys, in catalog order. */
export function stagedRoomLabels(raw: unknown): string[] {
  const keys = new Set(parseStagedRooms(raw));
  return STAGED_ROOMS.filter((r) => keys.has(r.key)).map((r) => r.label);
}
