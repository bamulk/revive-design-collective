import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { todayPacificISO, formatMDY, APP_TZ } from "@/lib/time";
import { getWarehouseCoords } from "@/lib/distance";
import TodayMap, { type TodayMapPin } from "@/components/TodayMap";
import PlanRow, { type PlanJob, type Stager } from "./PlanRow";

export const dynamic = "force-dynamic";

/**
 * Plan page — visible to admins and stagers. Shows the next 3 days
 * (today + 2) of stages and destages, grouped by day. Admins can
 * assign each job to a team (Grey / White / Little) plus the specific
 * stagers on that team. Stagers see the same plan read-only — useful
 * for checking what's on their crew over the next few days.
 *
 * Both fields are stored on the stage row itself (team,
 * assigned_stager_ids) so the assignment travels with the job — no
 * separate teams table, since team membership shifts per-day.
 */
export default async function PlanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single()
    : { data: null };
  const isAdmin = me?.role === "admin";
  const todayISO = todayPacificISO();

  // Build the 3-day window in Pacific.
  const days: string[] = [];
  {
    const base = new Date(todayISO + "T12:00:00Z");
    for (let i = 0; i < 3; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      days.push(d.toISOString().slice(0, 10));
    }
  }
  const windowStart = days[0];
  const windowEnd = days[days.length - 1];

  const [
    { data: stageRows },
    { data: destageRows },
    { data: stagerRows },
    { data: weeklyRows },
    { data: availabilityRows },
  ] = await Promise.all([
      supabase
        .from("stages")
        .select(
          "id, address, city, lat, lng, stage_date, status, team, assigned_stager_ids, clients(name)",
        )
        .neq("status", "estimate")
        .neq("status", "cancelled")
        .gte("stage_date", windowStart)
        .lte("stage_date", windowEnd),
      supabase
        .from("stages")
        .select(
          "id, address, city, lat, lng, destage_date, status, destage_team, destage_stager_ids, clients(name)",
        )
        .neq("status", "estimate")
        .neq("status", "cancelled")
        .gte("destage_date", windowStart)
        .lte("destage_date", windowEnd),
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("role", ["stager", "lead_stager"])
        .order("full_name", { ascending: true, nullsFirst: false }),
      // Recurring weekly schedules (all stagers).
      supabase
        .from("stager_weekly_availability")
        .select("stager_id, weekday"),
      // Per-date overrides across the 3-day window.
      supabase
        .from("stager_availability")
        .select("stager_id, date, available")
        .gte("date", windowStart)
        .lte("date", windowEnd),
    ]);

  // Effective availability = per-day override if present, else the
  // stager's recurring weekly default. Build both lookups first.
  const weeklyByStager = new Map<string, Set<number>>();
  for (const r of (weeklyRows ?? []) as {
    stager_id: string;
    weekday: number;
  }[]) {
    if (!weeklyByStager.has(r.stager_id))
      weeklyByStager.set(r.stager_id, new Set());
    weeklyByStager.get(r.stager_id)!.add(r.weekday);
  }
  // stager_id -> (date -> available override)
  const overrideByStager = new Map<string, Map<string, boolean>>();
  for (const r of (availabilityRows ?? []) as {
    stager_id: string;
    date: string;
    available: boolean;
  }[]) {
    if (!overrideByStager.has(r.stager_id))
      overrideByStager.set(r.stager_id, new Map());
    overrideByStager.get(r.stager_id)!.set(r.date, r.available);
  }

  // date (YYYY-MM-DD) -> set of stager ids effectively available that day.
  const availableByDay = new Map<string, Set<string>>();
  for (const d of days) {
    const weekday = new Date(d + "T12:00:00Z").getUTCDay();
    const set = new Set<string>();
    for (const s of stagerRows ?? []) {
      const id = (s as { id: string }).id;
      const override = overrideByStager.get(id)?.get(d);
      const free =
        override !== undefined
          ? override
          : (weeklyByStager.get(id)?.has(weekday) ?? false);
      if (free) set.add(id);
    }
    availableByDay.set(d, set);
  }

  // First-name only on the Plan page — the chips are tight and full
  // names just wrap awkwardly. Fall back to the email local-part if
  // there's no full_name set yet.
  const stagers: Stager[] = (stagerRows ?? []).map((p: any) => {
    const full = (p.full_name ?? "").trim();
    const first = full ? full.split(/\s+/)[0] : "";
    const emailLocal = (p.email ?? "").split("@")[0] || "Unnamed";
    return {
      id: p.id,
      name: first || emailLocal,
    };
  });

  // Group jobs by day. A single stage can appear on two different days
  // if its stage_date and destage_date both fall in the window — that's
  // intentional, we want both events to show up.
  const byDay = new Map<string, PlanJob[]>();
  // Parallel per-day map of map pins (only jobs with cached coords).
  const pinsByDay = new Map<string, TodayMapPin[]>();
  for (const d of days) {
    byDay.set(d, []);
    pinsByDay.set(d, []);
  }

  function pushJob(day: string, job: PlanJob) {
    if (!byDay.has(day)) return;
    byDay.get(day)!.push(job);
  }
  function pushPin(day: string, pin: TodayMapPin) {
    if (!pinsByDay.has(day)) return;
    pinsByDay.get(day)!.push(pin);
  }

  for (const r of (stageRows ?? []) as any[]) {
    if (!r.stage_date) continue;
    pushJob(r.stage_date, {
      id: r.id,
      address: r.address,
      city: r.city ?? null,
      clientName: r.clients?.name ?? null,
      kind: "stage",
      team: r.team ?? null,
      stagerIds: Array.isArray(r.assigned_stager_ids)
        ? r.assigned_stager_ids
        : [],
    });
    if (r.lat != null && r.lng != null) {
      pushPin(r.stage_date, {
        id: r.id,
        address: r.address,
        city: r.city ?? null,
        clientName: r.clients?.name ?? null,
        kind: "stage",
        team: (r.team as "grey" | "white" | "little" | null) ?? null,
        lat: Number(r.lat),
        lng: Number(r.lng),
      });
    }
  }
  for (const r of (destageRows ?? []) as any[]) {
    if (!r.destage_date) continue;
    pushJob(r.destage_date, {
      id: r.id,
      address: r.address,
      city: r.city ?? null,
      clientName: r.clients?.name ?? null,
      kind: "destage",
      team: r.destage_team ?? null,
      stagerIds: Array.isArray(r.destage_stager_ids)
        ? r.destage_stager_ids
        : [],
    });
    if (r.lat != null && r.lng != null) {
      pushPin(r.destage_date, {
        id: r.id,
        address: r.address,
        city: r.city ?? null,
        clientName: r.clients?.name ?? null,
        kind: "destage",
        team:
          (r.destage_team as "grey" | "white" | "little" | null) ?? null,
        lat: Number(r.lat),
        lng: Number(r.lng),
      });
    }
  }

  const warehouse = await getWarehouseCoords();

  // Destages before stages within a day (matches the dashboard Today
  // ordering — destage happens first in the morning so it goes on top).
  for (const list of byDay.values()) {
    list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "destage" ? -1 : 1));
  }

  function dayLabel(iso: string) {
    if (iso === todayISO) return "Today";
    const tomorrow = new Date(
      new Date(todayISO + "T12:00:00Z").getTime() + 86400000,
    )
      .toISOString()
      .slice(0, 10);
    if (iso === tomorrow) return "Tomorrow";
    // Weekday + mm/dd/yy
    const weekday = new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: APP_TZ,
    });
    return `${weekday}`;
  }

  const totalJobs = Array.from(byDay.values()).reduce(
    (sum, list) => sum + list.length,
    0,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Plan"
        subtitle={`Next 3 days · ${totalJobs} job${totalJobs === 1 ? "" : "s"} to assign`}
      />

      {totalJobs === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          Nothing scheduled in the next 3 days.
        </Card>
      ) : (
        <div className="space-y-6">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            return (
              <section key={d} className="space-y-3">
                <div className="flex items-baseline justify-between border-b border-slate-200 dark:border-slate-700 pb-1">
                  <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                    {dayLabel(d)}
                  </h2>
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {formatMDY(d)} · {list.length} job{list.length === 1 ? "" : "s"}
                  </span>
                </div>
                {list.length === 0 ? (
                  <p className="text-sm italic text-slate-500 dark:text-slate-400 px-1">
                    Nothing scheduled.
                  </p>
                ) : (
                  <>
                    {(pinsByDay.get(d) ?? []).length > 0 && (
                      <TodayMap
                        pins={pinsByDay.get(d) ?? []}
                        warehouse={warehouse}
                      />
                    )}
                    <div className="space-y-2">
                      {list.map((job) => (
                        <PlanRow
                          key={`${job.kind}-${job.id}`}
                          job={job}
                          stagers={stagers}
                          availableStagerIds={[
                            ...(availableByDay.get(d) ?? []),
                          ]}
                          isAdmin={isAdmin}
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
