"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  PlusCircle,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui";
import { formatMDY } from "@/lib/time";
import { type ActivityItem } from "@/lib/activity-items";

export type { ActivityItem };

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Upcoming",
  staged: "Staged",
  destaged: "Destaged",
  completed: "Completed",
  cancelled: "Cancelled",
  estimate: "Estimate",
};

// Filter chips — one per activity kind. Order controls chip order.
const KIND_META: { kind: string; label: string; icon: LucideIcon; color: string }[] =
  [
    { kind: "stage_status_change", label: "Status", icon: ArrowRight, color: "text-blue-700" },
    { kind: "photo_added", label: "Photos", icon: Camera, color: "text-amber-700" },
    { kind: "payment_recorded", label: "Payments", icon: CircleDollarSign, color: "text-emerald-700" },
    { kind: "stage_created", label: "Created", icon: PlusCircle, color: "text-emerald-700" },
    { kind: "stage_deleted", label: "Deleted", icon: Trash2, color: "text-rose-700" },
    // NOTE: every logged ActivityKind MUST be listed here — the filter
    // starts from this list, so an unlisted kind never renders at all
    // (even in the per-stage box, which hides the chips but still
    // filters by it).
    { kind: "stage_client_change", label: "Client", icon: UserRound, color: "text-sky-700" },
  ];
const ALL_KINDS = KIND_META.map((k) => k.kind);

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Friendly "2 hours ago" / "5 days ago" — falls back to full date. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.round((now - then) / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  return formatMDY(iso);
}

function actorDisplay(item: ActivityItem): string {
  const n = (item.actor_name ?? "").trim();
  if (n) return n;
  const e = (item.actor_email ?? "").trim();
  if (e) return e.split("@")[0];
  return "Someone";
}

/** "3 photos", "2 videos", "3 photos and 2 videos". */
function mediaLabel(photos: number, videos: number): string {
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} photo${photos === 1 ? "" : "s"}`);
  if (videos > 0) parts.push(`${videos} video${videos === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" and ") : "media";
}

function renderEvent(item: ActivityItem): {
  icon: React.ReactNode;
  text: React.ReactNode;
} {
  const actor = actorDisplay(item);
  const details = (item.details ?? {}) as Record<string, any>;
  const addr = item.stage_address ?? "a stage";

  switch (item.kind) {
    case "stage_status_change": {
      const from = STATUS_LABELS[String(details.from ?? "")] ?? details.from;
      const to = STATUS_LABELS[String(details.to ?? "")] ?? details.to;
      return {
        icon: <ArrowRight size={14} className="text-blue-700" />,
        text: (
          <>
            <strong>{actor}</strong> moved <em>{addr}</em> from{" "}
            <strong>{from}</strong> to <strong>{to}</strong>
          </>
        ),
      };
    }
    case "stage_created":
      return {
        icon: <PlusCircle size={14} className="text-emerald-700" />,
        text: (
          <>
            <strong>{actor}</strong> created <em>{addr}</em>
            {details.status === "estimate" && " as an estimate"}
          </>
        ),
      };
    case "stage_deleted":
      return {
        icon: <Trash2 size={14} className="text-rose-700" />,
        text: (
          <>
            <strong>{actor}</strong> deleted <em>{addr}</em>
          </>
        ),
      };
    case "photo_added": {
      const photos = item.photoCount ?? 0;
      const videos = item.videoCount ?? 0;
      return {
        icon: <Camera size={14} className="text-amber-700" />,
        text: (
          <>
            <strong>{actor}</strong> added {mediaLabel(photos, videos)} to{" "}
            <em>{addr}</em>
          </>
        ),
      };
    }
    case "stage_client_change":
      return {
        icon: <UserRound size={14} className="text-sky-700" />,
        text: (
          <>
            <strong>{actor}</strong> changed the client on <em>{addr}</em>
            {details.from ? (
              <>
                {" "}from <strong>{String(details.from)}</strong>
              </>
            ) : null}{" "}
            to <strong>{String(details.to ?? "")}</strong>
          </>
        ),
      };
    case "payment_recorded": {
      const amt = Number(details.amount ?? 0);
      const method = details.method ? ` via ${details.method}` : "";
      return {
        icon: <CircleDollarSign size={14} className="text-emerald-700" />,
        text: (
          <>
            <strong>{actor}</strong> recorded a {fmtMoney(amt)} payment
            {method} on <em>{addr}</em>
          </>
        ),
      };
    }
    default:
      return {
        icon: <CheckCircle2 size={14} className="text-slate-500" />,
        text: (
          <>
            <strong>{actor}</strong> · {item.kind}
            {addr && (
              <>
                {" "}on <em>{addr}</em>
              </>
            )}
          </>
        ),
      };
  }
}

export default function ActivityFeed({
  items,
  showFilters = true,
  linkToStage = true,
  emptyText = "Nothing logged in the last 5 days. Activity appears here as stages move, photos are added, and payments come in.",
}: {
  items: ActivityItem[];
  /** Show the per-type filter chips (off for the single-stage box). */
  showFilters?: boolean;
  /** Wrap each row in a link to its stage (off when already on that stage). */
  linkToStage?: boolean;
  /** Message shown when there is no activity at all. */
  emptyText?: React.ReactNode;
}) {
  // Which kinds are visible. Default: all.
  const [active, setActive] = useState<Set<string>>(() => new Set(ALL_KINDS));

  // Per-kind counts for the chip badges (over the full 5-day window).
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.kind, (m.get(it.kind) ?? 0) + 1);
    return m;
  }, [items]);

  const allOn = active.size === ALL_KINDS.length;

  function toggle(kind: string) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const filtered = useMemo(
    () => items.filter((it) => active.has(it.kind)),
    [items, active],
  );

  // Group the filtered items by day so the feed scans naturally.
  const byDay = useMemo(() => {
    const m = new Map<string, ActivityItem[]>();
    for (const it of filtered) {
      const key = it.created_at.slice(0, 10);
      const arr = m.get(key) ?? [];
      arr.push(it);
      m.set(key, arr);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const chip =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ring-1 ring-inset transition";
  const chipOn =
    "bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white";
  const chipOff =
    "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800";

  return (
    <div className="space-y-6">
      {/* Type filters */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActive(new Set(ALL_KINDS))}
            aria-pressed={allOn}
            className={`${chip} ${allOn ? chipOn : chipOff}`}
          >
            All
          </button>
          {KIND_META.map((k) => {
            const on = active.has(k.kind);
            const Icon = k.icon;
            const n = counts.get(k.kind) ?? 0;
            return (
              <button
                key={k.kind}
                type="button"
                onClick={() => toggle(k.kind)}
                aria-pressed={on}
                className={`${chip} ${on ? chipOn : chipOff}`}
              >
                <Icon size={13} className={on ? "" : k.color} />
                {k.label}
                <span className={on ? "opacity-80" : "text-slate-400"}>{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {items.length === 0 ? (
        <Card className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          <Activity
            size={28}
            className="mx-auto mb-2 text-slate-400 dark:text-slate-500"
          />
          {emptyText}
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          No activity of the selected type in the last 5 days.
        </Card>
      ) : (
        <div className="space-y-6">
          {byDay.map(([day, dayItems]) => (
            <section key={day} className="space-y-2">
              <h2 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {formatMDY(day)}
              </h2>
              <Card className="divide-y divide-slate-200 dark:divide-slate-700 overflow-hidden">
                {dayItems.map((it) => {
                  const ev = renderEvent(it);
                  const body = (
                    <div className="flex items-start gap-3 p-3 sm:p-4">
                      <span className="mt-0.5 w-6 h-6 inline-flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 shrink-0">
                        {ev.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800 dark:text-slate-200 leading-snug">
                          {ev.text}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {timeAgo(it.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                  return it.stage_id && linkToStage ? (
                    <Link
                      key={it.id}
                      href={`/stages/${it.stage_id}`}
                      className="block hover:bg-slate-50 dark:hover:bg-slate-900/60 transition"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div key={it.id}>{body}</div>
                  );
                })}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
