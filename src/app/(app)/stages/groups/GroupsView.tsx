"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import TeamTag from "@/components/TeamTag";
import {
  Search,
  X,
  ChevronDown,
  Calendar,
  Clock,
  Archive,
  CheckCircle2,
  XCircle,
  CheckSquare,
  CircleDollarSign,
  MapPin,
} from "lucide-react";

export type GroupStage = {
  id: string;
  address: string;
  city: string | null;
  neighborhood: string | null;
  client_name: string | null;
  amount: number;
  status: string;
  stage_date: string | null;
  destage_date: string | null;
  paid_at: string | null;
  thumb_url: string | null;
  tasks_done: number;
  tasks_total: number;
  /** Distance from the barn in miles (null when lat/lng not cached yet). */
  miles: number | null;
  square_footage: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  primary_only: boolean;
  team: "grey" | "white" | "little" | null;
  escrow: boolean;
};

// Color language across the app:
//   Scheduled (upcoming stage) → BLUE
//   Staged    (next event is a destage) → ORANGE
//   Destaged  → emerald
//   Completed → emerald (deeper)
//   Cancelled → rose
//
// The cardTint is a very soft background tint applied to the whole
// stage card so a glance at the page immediately separates stages
// from destages.
type StatusDef = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  chipActive: string;
  chipIdle: string;
  accent: string;
  cardTint: string;
};

const STATUSES: StatusDef[] = [
  {
    key: "scheduled",
    label: "Upcoming",
    icon: Calendar,
    chipActive: "bg-blue-600 text-white border-blue-600",
    chipIdle:
      "bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950/40",
    accent:
      "bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-900/50",
    cardTint:
      "bg-blue-50/60 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/50 hover:bg-blue-50 dark:hover:bg-blue-950/50",
  },
  {
    key: "staged",
    label: "Staged",
    icon: Clock,
    chipActive: "bg-orange-600 text-white border-orange-600",
    chipIdle:
      "bg-white dark:bg-slate-900 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-900 hover:bg-orange-50 dark:hover:bg-orange-950/40",
    accent:
      "bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300 ring-orange-200 dark:ring-orange-900/50",
    cardTint:
      "bg-orange-50/60 dark:bg-orange-950/30 border-orange-200 dark:border-orange-900/50 hover:bg-orange-50 dark:hover:bg-orange-950/50",
  },
  {
    key: "destaged",
    label: "Destages",
    icon: Archive,
    chipActive: "bg-emerald-600 text-white border-emerald-600",
    chipIdle:
      "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/40",
    accent:
      "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900/50",
    cardTint:
      "bg-emerald-50/60 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50 hover:bg-emerald-50 dark:hover:bg-emerald-950/50",
  },
  {
    key: "completed",
    label: "Completed",
    icon: CheckCircle2,
    chipActive: "bg-slate-700 text-white border-slate-700",
    chipIdle:
      "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900",
    accent:
      "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 ring-slate-200 dark:ring-slate-700",
    cardTint:
      "bg-slate-50 dark:bg-slate-900/80 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800",
  },
  {
    key: "cancelled",
    label: "Cancelled",
    icon: XCircle,
    chipActive: "bg-rose-600 text-white border-rose-600",
    chipIdle:
      "bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/40",
    accent:
      "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900/50",
    cardTint:
      "bg-rose-50/60 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50 hover:bg-rose-50 dark:hover:bg-rose-950/50",
  },
];

export default function GroupsView({
  stages,
  isAdmin = false,
}: {
  stages: GroupStage[];
  isAdmin?: boolean;
}) {
  const [query, setQuery] = useState("");
  // Track which status section is currently in view, to highlight its chip.
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const wantedStatus = searchParams.get("status");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Filter by query (matches address + client name across whitespace tokens).
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stages;
    const tokens = q.split(/\s+/);
    return stages.filter((s) => {
      const hay = `${s.address ?? ""} ${s.client_name ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [stages, query]);

  // Group by status. Inside the 'scheduled' (Upcoming) bucket, sort
  // by stage_date ASCENDING — the next stage to actually happen
  // belongs at the top, not the one farthest in the future.
  // Other statuses keep the page-level sort (newest first).
  const byStatus = useMemo(() => {
    const map = new Map<string, GroupStage[]>();
    for (const s of visible) {
      const arr = map.get(s.status) ?? [];
      arr.push(s);
      map.set(s.status, arr);
    }
    // Order each section by the date that matters for it:
    //   Upcoming  -> stage_date    ascending  (soonest upcoming stage)
    //   Staged    -> stage_date    descending (most recently staged first)
    //   Destages  -> destage_date  ascending  (soonest destage to do)
    //   Completed -> destage_date  descending (most recently destaged first)
    // Cancelled sorts newest-first by stage_date. Undated stages always
    // sink to the bottom.
    const relevantDate = (s: GroupStage, status: string) =>
      status === "destaged" || status === "completed"
        ? s.destage_date ?? s.stage_date ?? null
        : s.stage_date ?? null;
    for (const [status, arr] of map) {
      const asc = status === "scheduled" || status === "destaged";
      arr.sort((a, b) => {
        const da = relevantDate(a, status);
        const db = relevantDate(b, status);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return asc ? da.localeCompare(db) : db.localeCompare(da);
      });
    }
    return map;
  }, [visible]);

  // Highlight the chip for whichever section is currently most-visible.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visibleEntry?.target?.id) {
          setActiveStatus(visibleEntry.target.id.replace("section-", ""));
        }
      },
      { rootMargin: "-120px 0px -50% 0px", threshold: [0, 0.25, 0.5, 1] }
    );
    Object.values(sectionRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [byStatus]);

  function scrollTo(statusKey: string) {
    const el = sectionRefs.current[statusKey];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // Deep link from the dashboard status cards: /stages/groups?status=...
  // jumps straight to that section (and the section is force-opened
  // below). Runs once for the initial param.
  useEffect(() => {
    if (!wantedStatus) return;
    setActiveStatus(wantedStatus);
    const t = setTimeout(() => scrollTo(wantedStatus), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedStatus]);

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by address or client…"
            className="w-full border rounded-lg pl-8 pr-8 py-2 text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {query && (
          <span className="text-xs text-slate-600 dark:text-slate-400">
            {visible.length} match{visible.length === 1 ? "" : "es"}
          </span>
        )}
      </div>

      {/* Sticky status chips — the "breadcrumb across the top." */}
      <div
        className="
          sticky top-14 z-30
          -mx-4 sm:mx-0 px-4 sm:px-0
          py-2 bg-slate-50 dark:bg-slate-900/95 backdrop-blur-md
          border-y border-slate-200 dark:border-slate-700
        "
      >
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-2 px-2 [scrollbar-width:thin]">
          {STATUSES.map((s) => {
            const Icon = s.icon;
            const count = byStatus.get(s.key)?.length ?? 0;
            const isActive = activeStatus === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => scrollTo(s.key)}
                className={`
                  shrink-0 inline-flex items-center gap-1.5
                  px-3 py-1.5 rounded-full text-sm font-medium
                  border transition
                  ${isActive ? s.chipActive : s.chipIdle}
                `}
              >
                <Icon size={13} />
                {s.label}
                <span
                  className={`
                    inline-flex items-center justify-center
                    min-w-[1.25rem] h-5 px-1
                    rounded-full text-[11px] tabular-nums
                    ${isActive ? "bg-white text-slate-900 dark:bg-slate-900/25 dark:text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"}
                  `}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {STATUSES.map((s) => {
          const list = byStatus.get(s.key) ?? [];
          // Keep cancelled hidden when empty + no search active to reduce noise.
          if (s.key === "cancelled" && list.length === 0 && !query) return null;
          return (
            <div
              key={s.key}
              id={`section-${s.key}`}
              ref={(el) => {
                sectionRefs.current[s.key] = el;
              }}
              // scroll-margin-top covers the sticky header (h-14, ~56px)
              // + the sticky chip nav (~52px) so scroll-into-view lands
              // below them instead of being hidden behind.
              className="scroll-mt-32"
            >
              <StatusAccordion
                status={s}
                stages={list}
                isAdmin={isAdmin}
                forceOpen={wantedStatus === s.key}
                searching={query.trim().length > 0}
              />
            </div>
          );
        })}
      </div>

      {visible.length === 0 && (
        <div className="text-center text-sm text-slate-500 dark:text-slate-400 italic p-8">
          {query ? "No stages match that search." : "No stages yet."}
        </div>
      )}
    </div>
  );
}

function StatusAccordion({
  status,
  stages,
  isAdmin,
  forceOpen = false,
  searching = false,
}: {
  status: StatusDef;
  stages: GroupStage[];
  isAdmin: boolean;
  /** Open regardless of default — used when deep-linked from the dashboard. */
  forceOpen?: boolean;
  /** A search is active — force every section open so matches show. */
  searching?: boolean;
}) {
  const Icon = status.icon;
  // Staged + Completed are the noisiest sections — collapse them by
  // default so Upcoming / Destages (the actionable lists) sit on top
  // without scrolling. A deep link force-opens the targeted section.
  const defaultOpen =
    forceOpen || (status.key !== "staged" && status.key !== "completed");
  const [userOpen, setUserOpen] = useState(defaultOpen);
  // Cards (the heavy part — hundreds of StageCard nodes in Completed) are
  // only RENDERED when the section is open, so collapsed sections cost
  // nothing to hydrate. Search forces every section visible so matches
  // aren't hidden behind a collapsed accordion.
  const isOpen = userOpen || searching;
  return (
    <details
      open={isOpen}
      onToggle={(e) => {
        // Record user toggles; ignore the search-forced open state.
        if (!searching) setUserOpen(e.currentTarget.open);
      }}
      className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden [&_summary]:list-none [&_summary::-webkit-details-marker]:hidden"
    >
      <summary
        className="
          flex items-center justify-between gap-3
          cursor-pointer select-none
          px-4 sm:px-5 py-3.5
          hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors
        "
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`
              inline-flex items-center justify-center
              w-9 h-9 rounded-lg ring-1
              transition-transform duration-150
              ${status.accent}
            `}
          >
            <Icon size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 truncate leading-tight">
              {status.label}
            </h2>
            <div className="text-xs text-slate-600 dark:text-slate-400 truncate mt-0.5">
              {stages.length} stage{stages.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <ChevronDown
          size={20}
          className="text-slate-500 dark:text-slate-400 transition-transform -rotate-90 group-open:rotate-0 shrink-0"
        />
      </summary>

      {isOpen && (
        <div className="border-t border-slate-200 dark:border-slate-700 p-3 sm:p-4 bg-slate-50 dark:bg-slate-900/40 space-y-2">
          {stages.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 italic py-4 text-center">
              Nothing here.
            </p>
          ) : (
            stages.map((s) => (
              <StageCard
                key={s.id}
                stage={s}
                cardTint={status.cardTint}
                isAdmin={isAdmin}
              />
            ))
          )}
        </div>
      )}
    </details>
  );
}

function StageCard({
  stage,
  cardTint,
  isAdmin,
}: {
  stage: GroupStage;
  cardTint: string;
  isAdmin: boolean;
}) {
  return (
    <Link
      href={`/stages/${stage.id}`}
      className={`
        relative block border rounded-lg shadow-sm
        hover:shadow active:brightness-95 transition
        overflow-hidden
        ${cardTint}
      `}
    >
      {/* Team tag — bottom-right corner of the card. */}
      {stage.team && (
        <TeamTag
          team={stage.team}
          className="absolute bottom-1.5 right-1.5 z-10 shadow-sm"
        />
      )}
      <div className="flex gap-3">
        {/* Thumbnail — stretches to fill card height, no whitespace below */}
        <div className="shrink-0 self-stretch w-20 sm:w-24 bg-slate-100 dark:bg-slate-800 overflow-hidden">
          {stage.thumb_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              crossOrigin="anonymous"
              src={stage.thumb_url}
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

        {/* Content — Upcoming cards swap client/destage for city,
            miles-from-barn, and Zillow property details (sqft/bd/ba).
            Other statuses keep the original layout. */}
        <div className="flex-1 min-w-0 p-3 pr-3 space-y-1.5">
          {stage.status === "scheduled" ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {stage.address}
                  </div>
                  {(stage.city || stage.neighborhood) && (
                    <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1 truncate">
                      <MapPin size={11} className="shrink-0" />
                      {stage.neighborhood
                        ? `${stage.neighborhood}${stage.city ? ` · ${stage.city}` : ""}`
                        : stage.city}
                    </div>
                  )}
                  {stage.client_name && (
                    <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                      {stage.client_name}
                    </div>
                  )}
                </div>
                {isAdmin && (
                  <div className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
                    ${stage.amount.toFixed(0)}
                  </div>
                )}
              </div>

              {/* Property details + primary-only badge */}
              {(stage.square_footage != null ||
                stage.bedrooms != null ||
                stage.bathrooms != null ||
                stage.primary_only) && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-700 dark:text-slate-300">
                  {stage.square_footage != null && (
                    <span className="tabular-nums">
                      {stage.square_footage.toLocaleString()} sqft
                    </span>
                  )}
                  {stage.bedrooms != null && (
                    <>
                      {stage.square_footage != null && (
                        <span className="text-slate-300">·</span>
                      )}
                      <span className="tabular-nums">{stage.bedrooms} bd</span>
                    </>
                  )}
                  {stage.bathrooms != null && (
                    <>
                      {(stage.square_footage != null ||
                        stage.bedrooms != null) && (
                        <span className="text-slate-300">·</span>
                      )}
                      <span className="tabular-nums">
                        {stage.bathrooms} ba
                      </span>
                    </>
                  )}
                  {stage.primary_only && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-purple-100 text-purple-800 ring-1 ring-inset ring-purple-200">
                      Primary only
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {stage.stage_date && <DatePill date={stage.stage_date} />}
                {stage.miles != null && (
                  <span
                    className="text-[11px] text-slate-600 dark:text-slate-400"
                    title="Straight-line distance from barn"
                  >
                    {stage.miles.toFixed(1)} mi from barn
                  </span>
                )}
                {stage.tasks_total > 0 && (
                  <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
                    <CheckSquare size={11} />
                    {stage.tasks_done}/{stage.tasks_total}
                  </span>
                )}
                {stage.escrow && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:ring-violet-900/60">
                    Escrow
                  </span>
                )}
                {/* Upcoming stages haven't been worked/billed yet, so no
                    "Unpaid" tag — only show Paid on the rare prepaid one. */}
                {isAdmin && stage.paid_at && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200">
                    <CircleDollarSign size={10} /> Paid
                  </span>
                )}
              </div>
            </>
          ) : (
            // --- Original layout for Staged / Destaged / Completed / Cancelled ---
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {stage.address}
                  </div>
                  {(stage.city || stage.neighborhood) && (
                    <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1 truncate">
                      <MapPin size={11} className="shrink-0" />
                      {stage.neighborhood
                        ? `${stage.neighborhood}${stage.city ? ` · ${stage.city}` : ""}`
                        : stage.city}
                    </div>
                  )}
                  {stage.client_name && (
                    <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                      {stage.client_name}
                    </div>
                  )}
                </div>
                {isAdmin && (
                  <div className="text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100 shrink-0">
                    ${stage.amount.toFixed(0)}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {/* Destages section shows ONLY the destage date — the
                    stage date is in the past and adds noise. Other
                    statuses (staged / completed / cancelled) keep
                    both dates connected with an arrow. */}
                {stage.status === "destaged" ? (
                  stage.destage_date && <DatePill date={stage.destage_date} />
                ) : (
                  <>
                    {stage.stage_date && <DatePill date={stage.stage_date} />}
                    {stage.destage_date && (
                      <>
                        <span className="text-slate-400 dark:text-slate-500">-&gt;</span>
                        <DatePill date={stage.destage_date} />
                      </>
                    )}
                  </>
                )}
                {stage.tasks_total > 0 && (
                  <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
                    <CheckSquare size={11} />
                    {stage.tasks_done}/{stage.tasks_total}
                  </span>
                )}
                {stage.escrow && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold ring-1 ring-inset bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:ring-violet-900/60">
                    Escrow
                  </span>
                )}
                {isAdmin &&
                  (stage.paid_at ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200">
                      <CircleDollarSign size={10} /> Paid
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium ring-1 ring-inset bg-amber-50 text-amber-800 ring-amber-200">
                      Unpaid
                    </span>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

function DatePill({ date }: { date: string }) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(
    today.getMonth() + 1
  ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  let tone: string;
  if (date === todayStr) {
    tone = "bg-emerald-50 text-emerald-700 ring-emerald-200";
  } else if (date < todayStr) {
    tone = "bg-rose-50 text-rose-700 ring-rose-200";
  } else {
    tone = "bg-amber-50 text-amber-800 ring-amber-200";
  }

  // Display as mm/dd/yy — keeps the columns aligned and matches the
  // format used elsewhere in the app.
  const [y, m, d] = date.split("-").map(Number);
  const yy = String(y).slice(-2);
  const label = `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${yy}`;

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium ring-1 ring-inset tabular-nums ${tone}`}
    >
      {label}
    </span>
  );
}
