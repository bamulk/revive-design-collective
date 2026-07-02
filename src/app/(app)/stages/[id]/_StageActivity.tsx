import { createClient } from "@/lib/supabase/server";
import CollapsibleSection from "@/components/CollapsibleSection";
import ActivityFeed from "@/components/ActivityFeed";
import { condense, type ActivityRow } from "@/lib/activity-items";

/**
 * Activity history for a single stage — mirrors the global Activity feed
 * (same rendering + photo condensing) but scoped to one stage, with the
 * type filters off and no self-links. Streamed in via Suspense so it never
 * blocks the stage page's first paint. Visible to any internal user
 * (activity_log RLS = is_internal_user()).
 */
export default async function StageActivity({ stageId }: { stageId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activity_log")
    .select(
      "id, kind, actor_id, actor_name, actor_email, stage_id, stage_address, details, created_at",
    )
    .eq("stage_id", stageId)
    .order("created_at", { ascending: false })
    .limit(500);

  const items = condense((data ?? []) as ActivityRow[]);

  return (
    <CollapsibleSection
      id={`stage-${stageId}-activity`}
      title="Activity"
      subtitle={`${items.length} ${items.length === 1 ? "entry" : "entries"}`}
    >
      <ActivityFeed
        items={items}
        showFilters={false}
        linkToStage={false}
        emptyText="No activity logged for this stage yet."
      />
    </CollapsibleSection>
  );
}

/** Suspense placeholder mirroring the collapsed section header. */
export function StageActivityFallback() {
  return (
    <div className="flex items-center gap-3 bg-white dark:bg-slate-900 border rounded-xl shadow-sm px-4 sm:px-5 py-3.5">
      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-50 text-brand ring-1 ring-amber-100" />
      <div className="h-4 w-24 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
    </div>
  );
}
