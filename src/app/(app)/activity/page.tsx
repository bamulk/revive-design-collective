import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/require-admin";
import ActivityFeed from "@/components/ActivityFeed";
import { condense, type ActivityRow } from "@/lib/activity-items";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  await requireAdmin();
  const supabase = await createClient();

  // Last 5 days, newest first. The limit is generous headroom so a busy
  // window (photo uploads land one row each) isn't truncated before the
  // 5-day boundary; condense() then collapses photo dumps for display.
  const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("activity_log")
    .select(
      "id, kind, actor_id, actor_name, actor_email, stage_id, stage_address, details, created_at",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

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
