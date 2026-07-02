// Shared activity-feed types + the photo-condensing transform, used by
// both the global Activity page and the per-stage activity box.

export type ActivityItem = {
  id: string;
  kind: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  stage_id: string | null;
  stage_address: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  /** Set on condensed photo_added items — how many photos/videos the run
   *  collapsed into. Absent on all other kinds. */
  photoCount?: number;
  videoCount?: number;
};

export type ActivityRow = {
  id: string;
  kind: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  stage_id: string | null;
  stage_address: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Collapse raw activity rows into display items. Photo/video uploads —
 * which land as one `photo_added` row each (often dozens) — are condensed
 * into a single "added N photos" item per stage/person/day so a photo dump
 * doesn't bury everything else. Every other kind passes through one-to-one.
 * Rows must arrive newest-first; output preserves that order (a photo group
 * takes its newest timestamp).
 */
export function condense(rows: ActivityRow[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  const photoGroups = new Map<string, ActivityItem>();

  for (const r of rows) {
    if (r.kind === "photo_added") {
      const day = r.created_at.slice(0, 10);
      const key = `${day}|${r.stage_id ?? ""}|${r.actor_id ?? ""}`;
      const isVideo =
        (r.details as Record<string, unknown> | null)?.["media"] === "video";
      const existing = photoGroups.get(key);
      if (existing) {
        // Same person, same stage, same day — fold into the running group.
        if (isVideo) existing.videoCount = (existing.videoCount ?? 0) + 1;
        else existing.photoCount = (existing.photoCount ?? 0) + 1;
      } else {
        // First (newest) upload of the run — its timestamp anchors the item.
        const item: ActivityItem = {
          id: r.id,
          kind: "photo_added",
          actor_id: r.actor_id,
          actor_name: r.actor_name,
          actor_email: r.actor_email,
          stage_id: r.stage_id,
          stage_address: r.stage_address,
          details: r.details,
          created_at: r.created_at,
          photoCount: isVideo ? 0 : 1,
          videoCount: isVideo ? 1 : 0,
        };
        photoGroups.set(key, item);
        items.push(item);
      }
    } else {
      items.push(r as ActivityItem);
    }
  }

  return items;
}
