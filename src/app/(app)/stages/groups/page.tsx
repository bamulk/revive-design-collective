import { PlusCircle, CalendarDays, Map as MapIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import { PageHeader, LinkButton } from "@/components/ui";
import { getWarehouseCoords, haversineMiles } from "@/lib/distance";
import GroupsView, { type GroupStage } from "./GroupsView";
import { THUMB } from "@/lib/photo-urls";
import { signThumbsCached } from "@/lib/sign-thumbs";
import ScrollMemory from "@/components/ScrollMemory";

export const dynamic = "force-dynamic";

/**
 * Alternative to the kanban board: stages grouped by status into
 * stacked accordions, with a sticky status-chip nav at the top that
 * jumps to each section.
 */
export default async function StagesGroupsPage() {
  const supabase = await createClient();

  // Role lookup — non-admins shouldn't see stage prices.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = me?.role === "admin";

  // Every non-estimate stage ever (~800 and growing) — page past the
  // 1000-row cap with a unique id tiebreaker.
  const stages = await fetchAllRows((from, to) =>
    supabase
      .from("stages")
      .select(
        "id, address, city, neighborhood, amount, status, stage_date, destage_date, paid_at, lat, lng, square_footage, bedrooms, bathrooms, primary_only, team, destage_team, first_photo_storage_path, clients(name)"
      )
      // Estimates live in their own /estimates page; hide them from the board.
      .neq("status", "estimate")
      .order("stage_date", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );

  // Photos and tasks: fetch all and group client-side (same approach as
  // the board page — .in() with hundreds of UUIDs blows past PostgREST's
  // URL length cap).
  // First-photo lookup is cached on stages.first_photo_storage_path
  // (kept in sync by a trigger on stage_photos). Eliminates the
  // ~5000-row stage_photos scan this page used to do.
  const firstPhotoByStage = new Map<string, string>();
  for (const s of (stages ?? []) as any[]) {
    if (s.first_photo_storage_path) {
      firstPhotoByStage.set(s.id, s.first_photo_storage_path);
    }
  }

  // Serve small transformed thumbnails (Pro image transforms) instead
  // of the full originals — group cards only need a thumbnail. 24-hour
  // TTL keeps URLs valid across navs so the same image isn't re-signed
  // every time the user revisits this page.
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

  const stageIdSet = new Set((stages ?? []).map((s: any) => s.id));
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
    if (!stageIdSet.has(t.stage_id)) continue;
    taskCounts.set(t.stage_id, { done: t.done, total: t.total });
  }

  // Warehouse coords once — cached for the whole render. Used to compute
  // miles-from-warehouse on each Upcoming card.
  const warehouse = await getWarehouseCoords();

  const cards: GroupStage[] = (stages ?? []).map((s: any) => {
    const tc = taskCounts.get(s.id);
    const miles =
      warehouse && s.lat != null && s.lng != null
        ? haversineMiles(warehouse, { lat: Number(s.lat), lng: Number(s.lng) })
        : null;
    return {
      id: s.id,
      address: s.address,
      city: s.city ?? null,
      neighborhood: s.neighborhood ?? null,
      client_name: s.clients?.name ?? null,
      amount: Number(s.amount),
      status: s.status,
      stage_date: s.stage_date,
      destage_date: s.destage_date,
      paid_at: s.paid_at ?? null,
      thumb_url: thumbs.get(s.id) ?? null,
      tasks_done: tc?.done ?? 0,
      tasks_total: tc?.total ?? 0,
      miles,
      square_footage: s.square_footage ?? null,
      bedrooms: s.bedrooms ?? null,
      bathrooms: s.bathrooms != null ? Number(s.bathrooms) : null,
      primary_only: !!s.primary_only,
      // On the Destages list the relevant crew is whoever's destaging
      // it; everywhere else show the staging crew.
      team:
        ((s.status === "destaged" ? s.destage_team : s.team) as
          | "grey"
          | "white"
          | "little"
          | null) ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stages"
        subtitle="Grouped by status — tap a chip to jump to one"
        actions={
          <>
            <LinkButton href="/stages/calendar" variant="secondary">
              <CalendarDays size={14} /> Calendar
            </LinkButton>
            <LinkButton href="/stages/map" variant="secondary">
              <MapIcon size={14} /> Map
            </LinkButton>
            {isAdmin && (
              <LinkButton href="/stages/new">
                <PlusCircle size={14} /> New stage
              </LinkButton>
            )}
          </>
        }
      />
      <ScrollMemory id="stages-groups" />
      <GroupsView stages={cards} isAdmin={isAdmin} />
    </div>
  );
}
