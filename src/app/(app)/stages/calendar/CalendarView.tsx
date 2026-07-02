"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Calendar, List } from "lucide-react";

export type CalendarStage = {
  id: string;
  address: string;
  status: string;
  stage_date: string | null;
  destage_date: string | null;
  client_name: string | null;
};

type View = "month" | "week";
type Event = {
  stage: CalendarStage;
  kind: "stage" | "destage";
  /** ISO yyyy-mm-dd */
  date: string;
};

// All date math uses UTC so the local timezone of the user doesn't
// shift events to a neighboring day. stored stage_date / destage_date
// are plain dates (no time component).

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toISO(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function startOfWeekUTC(d: Date) {
  const out = new Date(d);
  out.setUTCDate(d.getUTCDate() - d.getUTCDay()); // Sunday-anchored
  out.setUTCHours(0, 0, 0, 0);
  return out;
}
function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setUTCDate(d.getUTCDate() + n);
  return out;
}
function addMonths(d: Date, n: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function startOfMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function todayUTC(): Date {
  // "Today" in Pacific, returned as a Date that compares cleanly against
  // the UTC-anchored grid cells the rest of this view uses. Vercel + most
  // browser clocks run in UTC, so we have to ask explicitly for Pacific.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value || "0");
  const m = Number(parts.find((p) => p.type === "month")?.value || "1");
  const d = Number(parts.find((p) => p.type === "day")?.value || "1");
  return new Date(Date.UTC(y, m - 1, d));
}

export default function CalendarView({ stages }: { stages: CalendarStage[] }) {
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<Date>(() => todayUTC());

  const allEvents: Event[] = useMemo(() => {
    const out: Event[] = [];
    for (const s of stages) {
      if (s.stage_date) out.push({ stage: s, kind: "stage", date: s.stage_date });
      if (s.destage_date)
        out.push({ stage: s, kind: "destage", date: s.destage_date });
    }
    return out;
  }, [stages]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const e of allEvents) {
      const arr = map.get(e.date) ?? [];
      arr.push(e);
      map.set(e.date, arr);
    }
    // Sort each day: stages first, then destages, then alphabetical.
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "stage" ? -1 : 1;
        return a.stage.address.localeCompare(b.stage.address);
      });
    }
    return map;
  }, [allEvents]);

  function prev() {
    setAnchor(view === "month" ? addMonths(anchor, -1) : addDays(anchor, -7));
  }
  function next() {
    setAnchor(view === "month" ? addMonths(anchor, 1) : addDays(anchor, 7));
  }
  function jumpToday() {
    setAnchor(todayUTC());
  }

  const headerLabel =
    view === "month"
      ? anchor.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })
      : (() => {
          const ws = startOfWeekUTC(anchor);
          const we = addDays(ws, 6);
          const wsStr = ws.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });
          const weStr = we.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          });
          return `${wsStr} – ${weStr}`;
        })();

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prev}
            aria-label="Previous"
            className="p-2 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={jumpToday}
            className="text-sm px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            Today
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next"
            className="p-2 rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ChevronRight size={16} />
          </button>
          <div className="ml-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            {headerLabel}
          </div>
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setView("month")}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm ${
              view === "month"
                ? "bg-slate-900 text-white"
                : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900"
            }`}
          >
            <Calendar size={14} /> Month
          </button>
          <button
            type="button"
            onClick={() => setView("week")}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm border-l border-slate-200 dark:border-slate-700 ${
              view === "week"
                ? "bg-slate-900 text-white"
                : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900"
            }`}
          >
            <List size={14} /> Week
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Stage
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-orange-500" /> Destage
        </span>
      </div>

      {view === "month" ? (
        <MonthGrid anchor={anchor} eventsByDate={eventsByDate} />
      ) : (
        <WeekList anchor={anchor} eventsByDate={eventsByDate} />
      )}
    </div>
  );
}

function MonthGrid({
  anchor,
  eventsByDate,
}: {
  anchor: Date;
  eventsByDate: Map<string, Event[]>;
}) {
  const monthStart = startOfMonthUTC(anchor);
  const gridStart = startOfWeekUTC(monthStart);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
  const todayISO = toISO(todayUTC());

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 bg-slate-50 dark:bg-slate-900 text-[11px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="p-2 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {cells.map((cell, i) => {
          const iso = toISO(cell);
          const events = eventsByDate.get(iso) ?? [];
          const isCurrentMonth = cell.getUTCMonth() === anchor.getUTCMonth();
          const isToday = iso === todayISO;
          return (
            <div
              key={i}
              className={`min-h-[88px] sm:min-h-[112px] p-1.5 border-b border-r border-slate-100 dark:border-slate-800 last:border-r-0 ${
                isCurrentMonth ? "bg-white dark:bg-slate-900" : "bg-slate-50 dark:bg-slate-900/40"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-[11px] font-medium ${
                    isToday
                      ? "bg-brand text-white rounded-full w-5 h-5 inline-flex items-center justify-center"
                      : isCurrentMonth
                      ? "text-slate-700 dark:text-slate-300"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {cell.getUTCDate()}
                </span>
              </div>
              <div className="space-y-0.5">
                {events.slice(0, 3).map((e, idx) => (
                  <EventChip key={idx} event={e} />
                ))}
                {events.length > 3 && (
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 px-1">
                    + {events.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekList({
  anchor,
  eventsByDate,
}: {
  anchor: Date;
  eventsByDate: Map<string, Event[]>;
}) {
  const weekStart = startOfWeekUTC(anchor);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) days.push(addDays(weekStart, i));
  const todayISO = toISO(todayUTC());

  return (
    <div className="space-y-2">
      {days.map((d) => {
        const iso = toISO(d);
        const events = eventsByDate.get(iso) ?? [];
        const isToday = iso === todayISO;
        return (
          <div
            key={iso}
            className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden ${
              isToday ? "ring-2 ring-amber-300" : ""
            }`}
          >
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="font-medium text-slate-900 dark:text-slate-100">
                {/* Day-of-week + mm/dd/yy. Keep the weekday because it's
                    the only thing breaking up a vertical list of dates. */}
                {d.toLocaleDateString("en-US", {
                  weekday: "long",
                  timeZone: "UTC",
                })}
                {", "}
                {`${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(-2)}`}
              </div>
              {isToday && (
                <span className="text-xs bg-brand text-white px-2 py-0.5 rounded-full">
                  Today
                </span>
              )}
            </div>
            <div className="p-2 space-y-1">
              {events.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500 italic px-2 py-1">
                  No events.
                </p>
              ) : (
                events.map((e, i) => <EventChip key={i} event={e} expanded />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EventChip({ event, expanded }: { event: Event; expanded?: boolean }) {
  // Blue = Stage, Orange = Destage. Matches the Today section on the
  // dashboard so the color language is consistent across the app.
  const tone =
    event.kind === "stage"
      ? "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100"
      : "bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100";
  return (
    <Link
      href={`/stages/${event.stage.id}`}
      className={`block ${
        expanded ? "px-2 py-1.5" : "px-1.5 py-0.5"
      } rounded text-[11px] border ${tone} transition`}
      title={`${event.kind === "destage" ? "Destage: " : "Stage: "}${event.stage.address}`}
    >
      <div className="flex items-start gap-1.5 min-w-0">
        <span
          className={`shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${
            event.kind === "stage" ? "bg-blue-500" : "bg-orange-500"
          }`}
        />
        <span className="font-medium truncate flex-1 leading-tight">
          {event.kind === "destage" ? "Destage: " : ""}
          {event.stage.address}
        </span>
      </div>
      {expanded && event.stage.client_name && (
        <div className="text-[10px] text-slate-500 dark:text-slate-400 ml-3 truncate">
          {event.stage.client_name}
        </div>
      )}
    </Link>
  );
}
