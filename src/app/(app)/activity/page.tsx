import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/require-admin";
import ActivityFeed from "@/components/ActivityFeed";
import { condense, type ActivityRow } from "@/lib/activity-items";
import { fetchAllRows } from "@/lib/fetch-all";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  await requireAdmin();
  const supabase = await createClient();

  // Last 5 days, newest first. Paged fetch — a .limit() above
  // PostgREST's 1000-row cap is silently truncated, and a busy photo
  // week (one row per upload) can exceed 1000 rows in 5 days.
  // condense() then collapses photo dumps for display.
  const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const data = await fetchAllRows((from, to) =>
    supabase
      .from("activity_log")
      .select(
        "id, kind, actor_id, actor_name, actor_email, stage_id, stage_address, details, created_at",
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );

  const items = condense((data ?? []) as ActivityRow[]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        subtitle="Status changes, photo uploads, and payments over the last 5 days — newest first"
      />
      <ActivityFeed items={items} />
    </div>
  );
}
