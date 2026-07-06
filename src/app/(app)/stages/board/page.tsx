import { PlusCircle, LayoutList } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import Board, { type BoardStage } from "./Board";
import { PageHeader, LinkButton } from "@/components/ui";
import { THUMB } from "@/lib/photo-urls";
import { signThumbsCached } from "@/lib/sign-thumbs";

export const dynamic = "force-dynamic";

export default async function StagesBoardPage() {
  const supabase = await createClient();

  // Sort newest first: latest stage_date wins, with brand-new cards that
  // don't have a stage_date yet bubbling to the top by created_at.
  // Every non-cancelled/estimate stage ever (~800 and growing), so page
  // past the 1000-row cap with a unique id tiebreaker.
  const stages = await fetchAllRows((from, to) =>
    supabase
      .from("stages")
      .select(
        "id, address, amount, status, stage_date, destage_date, first_photo_storage_path, clients(name), created_at",
      )
      .not("status", "in", "(cancelled,estimate)")
      .order("stage_date", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );

  const stageIds = new Set((stages ?? []).map((s) => s.id));

  // Thumbnails come from the trigger-maintained first_photo_storage_path
  // column (same as groups/dashboard) — no separate scan of the entire
  // ~5K-row stage_photos table, which was 5+ sequential round-trips on
  // every board load and back-nav.
  const firstPhotoByStage = new Map<string, string>();
  for (const s of (stages ?? []) as any[]) {
    if (s.first_photo_storage_path) {
      firstPhotoByStage.set(s.id, s.first_photo_storage_path);
    }
  }

  // Serve small transformed thumbnails (Pro image transforms) instead
  // of the full originals — board cards only need a thumbnail. 24h TTL
  // so revisits don't re-sign.
  const thumbs = new Map<string, string>();
  const photoEntries = Array.from(firstPhotoByStage.entries());
  if (photoEntries.length > 0) {
    const urlByPath = await signThumbsCached(
      "stage-photos",
      photoEntries.map(([, path]) => path),
      THUMB,
    );
    for (const [stageId, path] of photoEntries) {
      const url = urlByPath.get(path);
      if (url) thumbs.set(stageId, url);
    }
  }

  // Task counts per stage from the pre-aggregated view (~801 rows
  // instead of scanning the whole stage_tasks table and counting here).
  // One row per stage, so this crosses 1000 alongside the stages table.
  const taskRows = await fetchAllRows((from, to) =>
    supabase
      .from("stage_task_counts")
      .select("stage_id, total, done")
      .order("stage_id")
      .range(from, to),
  );
  const taskCounts = new Map<string, { done: number; total: number }>();
  for (const t of (taskRows ?? []) as any[]) {
    if (!stageIds.has(t.stage_id)) continue;
    taskCounts.set(t.stage_id, { done: t.done, total: t.total });
  }

  const cards: BoardStage[] = (stages ?? []).map((s: any) => {
    const tc = taskCounts.get(s.id);
    return {
      id: s.id,
      address: s.address,
      client_name: s.clients?.name ?? null,
      amount: Number(s.amount),
      status: s.status,
      stage_date: s.stage_date,
      destage_date: s.destage_date,
      thumb_url: thumbs.get(s.id) ?? null,
      tasks_done: tc?.done ?? 0,
      tasks_total: tc?.total ?? 0,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kanban board"
        subtitle="Drag cards to change their status"
        actions={
          <>
            <LinkButton href="/stages/groups" variant="secondary">
              ← Back to Board
            </LinkButton>
            <LinkButton href="/stages" variant="secondary">
              <LayoutList size={14} /> Table view
            </LinkButton>
            <LinkButton href="/stages/new">
              <PlusCircle size={14} /> New stage
            </LinkButton>
          </>
        }
      />
      <Board initialStages={cards} />
    </div>
  );
}
