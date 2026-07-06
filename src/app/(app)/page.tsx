import Link from "next/link";
import { Suspense } from "react";
import {
  PlusCircle,
  Calendar,
  Clock,
  Archive,
  CheckCircle2,
  MapPin,
  ClipboardList,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import { Card, PageHeader, LinkButton } from "@/components/ui";
import TeamTag from "@/components/TeamTag";
import TodayMap, { type TodayMapPin } from "@/components/TodayMap";
import OutstandingSection from "./_OutstandingSection";
import CurrentlyStagedSection from "./_CurrentlyStagedSection";
import PendingListingsSection from "./_PendingListingsSection";
import NeedPicturesSection from "./_NeedPicturesSection";
import { after } from "next/server";
import { geocodeAddress } from "@/lib/geocode";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBarnCoords, haversineMiles } from "@/lib/distance";
import { THUMB } from "@/lib/photo-urls";
import { signThumbsCached } from "@/lib/sign-thumbs";
import { todayPacificISO, pacificDateLabel, formatMDY, APP_TZ } from "@/lib/time";

// Each status tile gets a soft tinted background. In dark mode we
// pair the same hue with a deep, low-saturation surface so the tile
// is readable but doesn't burn out the eyes.
const STATUSES = [
  {
    key: "scheduled",
    label: "Upcoming",
    icon: Calendar,
    color: "text-blue-600 dark:text-blue-300",
    bg: "bg-blue-50 dark:bg-blue-950/40",
    ring: "ring-blue-100 dark:ring-blue-900/50",
  },
  {
    key: "staged",
    label: "Staged",
    icon: Clock,
    color: "text-orange-600 dark:text-orange-300",
    bg: "bg-orange-50 dark:bg-orange-950/40",
    ring: "ring-orange-100 dark:ring-orange-900/50",
  },
  {
    key: "destaged",
    label: "Destages",
    icon: Archive,
    color: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    ring: "ring-emerald-100 dark:ring-emerald-900/50",
  },
  {
    key: "completed",
    label: "Completed",
    icon: CheckCircle2,
    color: "text-slate-700 dark:text-slate-300",
    bg: "bg-slate-100 dark:bg-slate-800",
    ring: "ring-slate-200 dark:ring-slate-700",
  },
] as const;

type Period = "all" | "ytd" | "month";

type Range = { start: string; end: string; label: string } | null;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function rangeFor(period: Period, month: string | undefined, today: Date): Range {
  // Pacific-anchored — see src/lib/time.ts. UTC math here would shift
  // the year/month boundary by 7-8 hours.
  const todayStr = todayPacificISO();
  const [Yy, Mm] = todayStr.split("-");
  const Y = Number(Yy);
  const M = Mm;

  if (period === "ytd") {
    return { start: `${Y}-01-01`, end: todayStr, label: `Year to date (${Y})` };
  }
  if (period === "month") {
    const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : `${Y}-${M}`;
    const [yy, mm] = ym.split("-").map(Number);
    const startStr = `${ym}-01`;
    // Last day of that month: first of next month minus 1 ms.
    const next = new Date(Date.UTC(yy, mm, 1));
    const lastDay = new Date(next.getTime() - 86400000);
    const endStr = lastDay.toISOString().slice(0, 10);
    return { start: startStr, end: endStr, label: monthLabel(ym) };
  }
  return null;
}

export default async function DashboardPage() {
  // Dashboard is always Year-to-Date. The earlier period picker was
  // removed in favor of a fixed framing — see the subtitle for the
  // current range string.
  const period: Period = "ytd";
  const today = new Date();
  const range = rangeFor(period, undefined, today);

  const supabase = await createClient();

  // Role lookup so we can gate the inline "Mark paid" controls.
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

  // Build today's ISO string in PACIFIC time. Vercel servers run in
  // UTC, so `new Date().getFullYear()` etc. would give UTC's date and
  // "today" would roll over at 4-5 PM Pacific. The helper formats in
  // America/Los_Angeles regardless of the host TZ.
  const localToday = new Date();
  const todayLocalISO = todayPacificISO();

  // The Outstanding invoices and Currently-staged sections are
  // streamed in via their own async server components below so they
  // don't block first paint. We only pull the status-count rollup
  // and the today rows here.
  const [
    rows,
    { data: todayRows },
  ] = await Promise.all([
      // Estimates aren't part of the active pipeline — exclude from the
      // dashboard count rollups. This is every non-estimate stage ever
      // (~800 and growing), so page past the 1000-row cap.
      fetchAllRows((from, to) =>
        supabase
          .from("stages")
          .select("id, status, stage_date, created_at")
          .neq("status", "estimate")
          .order("id")
          .range(from, to),
      ),
      // Rows that belong on Today:
      //   - upcoming stages (scheduled) with stage_date <= today
      //   - destages: jobs in the 'destaged' status whose destage_date
      //     is today (i.e. they were destaged today).
      // The status filter is crucial — without it, every historical
      // stage matches stage_date.lte.today and the follow-up
      // stage_photos lookup blows past Postgres's 1000-row cap (so
      // photos silently drop off the today cards).
      supabase
        .from("stages")
        .select(
          "id, address, city, stage_date, destage_date, status, lockbox_code, lat, lng, square_footage, bedrooms, bathrooms, team, destage_team, assigned_stager_ids, destage_stager_ids, first_photo_storage_path, clients(name)"
        )
        .or(
          `and(stage_date.lte.${todayLocalISO},status.eq.scheduled),and(destage_date.eq.${todayLocalISO},status.eq.destaged)`,
        ),
    ]);

  // Fetch the first photo for each stage that's on today's list, plus
  // compute miles-from-barn from the cached lat/lng (or geocode now if
  // missing). This is a tiny list (rarely > 5 rows), so the parallel
  // fetches are cheap.
  type TodayCard = {
    id: string;
    address: string;
    city: string | null;
    status: string;
    clientName: string | null;
    lockboxCode: string | null;
    miles: number | null;
    photoUrl: string | null;
    squareFootage: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    team: "grey" | "white" | "little" | null;
    kind: "stage" | "destage";
    lat: number | null;
    lng: number | null;
    stagerIds: string[];
    /** Original scheduled date for this kind (stage_date or destage_date). */
    originalDate: string | null;
  };

  const todayRowsList = (todayRows ?? []) as any[];
  const stageIds = todayRowsList.map((r) => r.id);
  const barn = todayRowsList.length > 0 ? await getBarnCoords() : null;

  // First-photo path is cached on the stages row itself by trigger
  // (migration 028). No more separate stage_photos scan.
  let photoByStage = new Map<string, string>();
  if (stageIds.length > 0) {
    const firstByStage = new Map<string, string>();
    for (const r of todayRowsList) {
      if (r.first_photo_storage_path) {
        firstByStage.set(r.id, r.first_photo_storage_path);
      }
    }
    // Serve small transformed thumbnails (Pro image transforms) instead
    // of the full ~400 KB originals — the today cards show them at ~96px.
    // 24-hour TTL means the URLs stay valid across navigations.
    const entries = Array.from(firstByStage.entries());
    const paths = entries.map(([, path]) => path);
    if (paths.length > 0) {
      const urlByPath = await signThumbsCached("stage-photos", paths, THUMB);
      for (const [id, path] of entries) {
        const url = urlByPath.get(path);
        if (url) photoByStage.set(id, url);
      }
    }
  }

  // Resolve lat/lng for a row — uses the cached pair if present and
  // Use only the cached lat/lng on the row — never await a geocode
  // here, since Nominatim/Google can take 1-3s per row and that
  // blocks the whole dashboard render. Rows missing coords get
  // queued into a background geocode (see `after(...)` below) so
  // the next visit has them.
  function cachedCoords(r: any): { lat: number | null; lng: number | null } {
    return {
      lat: r.lat ?? null,
      lng: r.lng ?? null,
    };
  }

  // Collect any rows that still need geocoding. After the response is
  // sent, run them in the background and persist results back to the
  // row. Next 16's `after()` schedules work post-response.
  const needsGeocode: { id: string; address: string; city: string | null }[] = [];

  // A single row may appear twice if it's BOTH a stage AND destage today.
  const todayStages: TodayCard[] = [];
  const todayDestages: TodayCard[] = [];
  await Promise.all(
    todayRowsList.map(async (r) => {
      const { lat, lng } = cachedCoords(r);
      if ((lat == null || lng == null) && r.address) {
        needsGeocode.push({
          id: r.id,
          address: r.address,
          city: r.city ?? null,
        });
      }
      const miles =
        barn && lat != null && lng != null
          ? haversineMiles(barn, { lat, lng })
          : null;
      const base = {
        id: r.id,
        address: r.address,
        city: r.city ?? null,
        status: r.status,
        clientName: r.clients?.name ?? null,
        lockboxCode: r.lockbox_code ?? null,
        miles,
        photoUrl: photoByStage.get(r.id) ?? null,
        squareFootage: r.square_footage ?? null,
        bedrooms: r.bedrooms ?? null,
        bathrooms: r.bathrooms != null ? Number(r.bathrooms) : null,
        // For destage rows show the destage crew's tag; for stage
        // rows show the staging crew's tag.
        team: null as "grey" | "white" | "little" | null,
        lat,
        lng,
      };
      // Today's "Upcoming" stages = stage_date is today AND still in
      // scheduled status. If the stage is already 'staged' or beyond,
      // the work has happened — don't surface it as a pending stage.
      // Stage stays on Today as long as it hasn't been staged yet —
      // a scheduled stage with a past stage_date carries over until
      // someone moves it to 'staged'.
      if (
        r.stage_date &&
        r.stage_date <= todayLocalISO &&
        r.status === "scheduled"
      ) {
        todayStages.push({
          ...base,
          team: (r.team as "grey" | "white" | "little" | null) ?? null,
          kind: "stage",
          stagerIds: Array.isArray(r.assigned_stager_ids)
            ? (r.assigned_stager_ids as string[])
            : [],
          originalDate: r.stage_date,
        });
      }
      // Destages on Today: a job marked 'destaged' whose destage_date
      // is today (i.e. it was destaged today).
      if (r.destage_date === todayLocalISO && r.status === "destaged") {
        todayDestages.push({
          ...base,
          team:
            (r.destage_team as "grey" | "white" | "little" | null) ?? null,
          kind: "destage",
          stagerIds: Array.isArray(r.destage_stager_ids)
            ? (r.destage_stager_ids as string[])
            : [],
          originalDate: r.destage_date,
        });
      }
    }),
  );

  const hasToday = todayStages.length + todayDestages.length > 0;
  const todayLabel = pacificDateLabel(localToday);

  // Map pins for the today section — only rows that we have coords
  // for. Destages first (visual grouping with the list below).
  const todayMapPins: TodayMapPin[] = [
    ...todayDestages,
    ...todayStages,
  ]
    .filter((c) => c.lat != null && c.lng != null)
    .map((c) => ({
      id: c.id,
      address: c.address,
      city: c.city,
      clientName: c.clientName,
      kind: c.kind,
      lat: c.lat as number,
      lng: c.lng as number,
      team: c.team,
    }));

  // Default the team filter to whichever team the *current user* is
  // working on today. We scan today's stage/destage assignments for the
  // user's id and grab the team off the first match. Admins typically
  // aren't on the roster so they fall through to "All".
  let defaultTeam: "grey" | "white" | "little" | null = null;
  if (user) {
    const all = [...todayStages, ...todayDestages];
    const mine = all.find((c) => c.stagerIds.includes(user.id));
    defaultTeam = mine?.team ?? null;
  }

  // Days-staged + Outstanding-invoices math moved to the streamed
  // _CurrentlyStagedSection / _OutstandingSection components below.

  // Status counts are a snapshot of the current pipeline — not a
  // date-range aggregate. Filtering them by YTD would, for example,
  // exclude a "scheduled" job whose stage_date is next month even
  // though it's clearly still an upcoming job. So we count everything
  // that isn't already filtered out by the query (estimates excluded
  // server-side).
  const counts = new Map<string, number>();
  for (const r of rows ?? []) {
    counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  }

  // Stages YTD = anything booked or staged this calendar year. Falls
  // back to created_at when stage_date is null so freshly-booked
  // stages without a confirmed date still count. Year is taken from
  // Pacific so a stage created Jan 1 PST doesn't get counted as the
  // prior year (which it would in UTC).
  const currentYear = Number(todayPacificISO().slice(0, 4));
  const yearPrefix = `${currentYear}-`;
  let ytdCount = 0;
  for (const r of rows ?? []) {
    const d =
      r.stage_date ?? (r.created_at ? String(r.created_at).slice(0, 10) : null);
    if (d && d.startsWith(yearPrefix)) ytdCount += 1;
  }

  // Background geocode any Today rows we couldn't show coords for.
  // Runs AFTER the dashboard response is sent so it never blocks
  // first paint. Uses the service-role client so the writes go
  // through regardless of the current user's RLS.
  if (needsGeocode.length > 0) {
    after(async () => {
      const admin = createAdminClient();
      for (const r of needsGeocode) {
        const base = r.city ? `${r.address}, ${r.city}` : r.address;
        const query = /,\s*[A-Z]{2}\b/.test(base) ? base : `${base}, CA`;
        try {
          const coords = await geocodeAddress(query);
          if (coords) {
            await admin
              .from("stages")
              .update({ lat: coords.lat, lng: coords.lng })
              .eq("id", r.id);
          }
        } catch (e) {
          console.error("[dashboard background geocode]", r.id, e);
        }
      }
    });
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title="Dashboard"
        subtitle={`${ytdCount} stage${ytdCount === 1 ? "" : "s"} YTD`}
        actions={
          <>
            {/* Plan visible to everyone (read-only for stagers); New
                stage is admin-only since it kicks off the pricing
                + contract flow. */}
            <LinkButton href="/plan" variant="secondary">
              <ClipboardList size={14} /> Plan
            </LinkButton>
            {isAdmin && (
              <LinkButton href="/stages/new">
                <PlusCircle size={14} /> New stage
              </LinkButton>
            )}
          </>
        }
      />

      {/* Push toggle moved to the top nav bar (NavPushToggle). */}

      {/* Today — every stage and destage happening today. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Today
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{todayLabel}</p>
          </div>
          <Link
            href="/stages/calendar"
            className="text-sm text-brand hover:text-brand-hover"
          >
            Calendar →
          </Link>
        </div>
        {hasToday ? (
          // Destages first because they happen first in the day — the
          // existing staged house has to be cleared out before a new
          // stage can drop in.
          <div className="space-y-3">
            {todayMapPins.length > 0 && (
              <TodayMap
                pins={todayMapPins}
                barn={barn}
                defaultTeam={defaultTeam}
              />
            )}
            <div className="space-y-2">
              {todayDestages.map((s) => (
                <TodayCardItem
                  key={`d-${s.id}`}
                  item={s}
                  todayISO={todayLocalISO}
                />
              ))}
              {todayStages.map((s) => (
                <TodayCardItem
                  key={`s-${s.id}`}
                  item={s}
                  todayISO={todayLocalISO}
                />
              ))}
            </div>
          </div>
        ) : (
          <Card className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Nothing scheduled today.
          </Card>
        )}
      </section>

      {/* Stages by status — fixed at the top of the dashboard, not
          collapsible. This is the at-a-glance pipeline snapshot. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Stages by status
          </h2>
          <Link
            href="/stages/groups"
            className="text-sm text-brand hover:text-brand-hover"
          >
            Stages →
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {STATUSES.map((s) => {
            const Icon = s.icon;
            return (
              <Link
                key={s.key}
                href={`/stages/groups?status=${s.key}`}
                className={`${s.bg} ring-1 ${s.ring} rounded-xl p-4 hover:scale-[1.02] hover:shadow-sm transition block`}
              >
                <div className={`w-8 h-8 rounded-lg bg-white/70 dark:bg-slate-800/70 flex items-center justify-center ${s.color} mb-2`}>
                  <Icon size={16} />
                </div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-700 dark:text-slate-300">
                  {s.label}
                </div>
                <div className="text-2xl font-semibold mt-1 text-slate-900 dark:text-slate-100">
                  {counts.get(s.key) ?? 0}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Need Pictures — upcoming stages still missing photos. Streamed
          in; visible to everyone and hides itself when every upcoming
          stage already has a photo. */}
      <Suspense fallback={null}>
        <NeedPicturesSection />
      </Suspense>

      {/* Pending listings — staged jobs that went under contract on
          Zillow. Streamed in; the section hides itself when nothing
          matches so the dashboard stays clean. */}
      <Suspense fallback={null}>
        <PendingListingsSection />
      </Suspense>

      {/* Outstanding invoices — streams in via its own server
          component so it doesn't block the dashboard shell. */}
      {isAdmin && (
        <Suspense fallback={<SectionFallback title="Outstanding invoices" />}>
          <OutstandingSection />
        </Suspense>
      )}

      {/* Currently staged — same pattern. */}
      <Suspense fallback={<SectionFallback title="Currently staged" />}>
        <CurrentlyStagedSection />
      </Suspense>

    </div>
  );
}

/**
 * Single card for the Today list. Matches the stages-page card style
 * (horizontal layout with a small left thumbnail) and shows the
 * stage/destage tag using the StatusBadge palette, plus address, city,
 * client name, miles-from-barn, and lockbox code.
 */
function TodayCardItem({
  item,
  todayISO,
}: {
  item: {
    id: string;
    address: string;
    city: string | null;
    status: string;
    clientName: string | null;
    lockboxCode: string | null;
    miles: number | null;
    photoUrl: string | null;
    squareFootage: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    team: "grey" | "white" | "little" | null;
    kind: "stage" | "destage";
    originalDate: string | null;
  };
  /** Pacific "today" ISO date so we can flag rolled-over rows. */
  todayISO: string;
}) {
  const isOverdue =
    !!item.originalDate && item.originalDate < todayISO;
  // Stage = blue, Destage = orange. Complementary colors — easier to
  // tell apart at a glance than the blue/violet pairing used elsewhere.
  // The whole card is shaded with a soft tint of the color so a glance
  // at the Today list immediately separates stages from destages.
  const cardStyles =
    item.kind === "stage"
      ? "bg-blue-50/60 border-blue-200 hover:bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900/60 dark:hover:bg-blue-950/50"
      : "bg-orange-50/60 border-orange-200 hover:bg-orange-50 dark:bg-orange-950/30 dark:border-orange-900/60 dark:hover:bg-orange-950/50";
  const thumbBg =
    item.kind === "stage"
      ? "bg-blue-100 dark:bg-blue-950/60"
      : "bg-orange-100 dark:bg-orange-950/60";
  const tagStyles =
    item.kind === "stage"
      ? "bg-blue-600 text-white ring-blue-700 dark:bg-blue-500 dark:ring-blue-400"
      : "bg-orange-600 text-white ring-orange-700 dark:bg-orange-500 dark:ring-orange-400";
  const tagLabel = item.kind === "stage" ? "Stage" : "Destage";

  return (
    <Link
      href={`/stages/${item.id}`}
      className={`
        relative block border rounded-lg shadow-sm
        hover:shadow active:brightness-95 transition
        overflow-hidden
        ${cardStyles}
      `}
    >
      {/* Team tag — bottom-right of the card. */}
      {item.team && (
        <TeamTag
          team={item.team}
          className="absolute bottom-1.5 right-1.5 z-10 shadow-sm"
        />
      )}
      <div className="flex gap-3">
        {/* Thumbnail — keep width fixed but stretch vertically to fill
            the card so there's no whitespace below the image. */}
        <div
          className={`shrink-0 self-stretch w-20 sm:w-24 overflow-hidden ${thumbBg}`}
        >
          {item.photoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={item.photoUrl}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400 dark:text-slate-500 text-center px-1">
              No photo
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 p-3 pr-3 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                {item.address}
              </div>
              {item.city && (
                <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1 truncate">
                  <MapPin size={11} className="shrink-0" />
                  {item.city}
                </div>
              )}
              {item.clientName && (
                <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                  {item.clientName}
                </div>
              )}
            </div>
            {/* Stage/Destage tag (+ Overdue chip when carried over from
                a prior day) — top right, matching the price slot in
                StageCard */}
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${tagStyles}`}
              >
                {tagLabel}
              </span>
              {isOverdue && item.originalDate && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold ring-1 ring-inset bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900/60"
                  title="Carried over from a previous day"
                >
                  From {formatMDY(item.originalDate)}
                </span>
              )}
            </div>
          </div>

          {/* Property details (Zillow data): sqft · beds · baths */}
          {(item.squareFootage != null ||
            item.bedrooms != null ||
            item.bathrooms != null) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-700 dark:text-slate-300">
              {item.squareFootage != null && (
                <span className="tabular-nums">
                  {item.squareFootage.toLocaleString()} sqft
                </span>
              )}
              {item.squareFootage != null && item.bedrooms != null && (
                <span className="text-slate-300">·</span>
              )}
              {item.bedrooms != null && (
                <span className="tabular-nums">
                  {item.bedrooms} bd
                </span>
              )}
              {item.bedrooms != null && item.bathrooms != null && (
                <span className="text-slate-300">·</span>
              )}
              {item.bathrooms != null && (
                <span className="tabular-nums">
                  {item.bathrooms} ba
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-400">
            {item.miles != null && (
              <span title="Straight-line distance from 6135 Rio Linda Blvd">
                {item.miles.toFixed(1)} mi from barn
              </span>
            )}
            {item.lockboxCode && (
              <span>
                Lockbox{" "}
                <span className="font-mono tracking-wider">
                  {item.lockboxCode}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

/**
 * Skeleton placeholder rendered while a streamed section is loading.
 * Matches the height + corner-rounding of CollapsibleSection so the
 * page layout doesn't jump when the real content arrives.
 */
function SectionFallback({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {title}
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500">
          Loading…
        </div>
      </div>
      <div className="mt-3 h-2 w-1/3 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
    </div>
  );
}

