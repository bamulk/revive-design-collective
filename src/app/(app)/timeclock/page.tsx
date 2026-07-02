import { Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireTeamMember } from "@/lib/permissions";
import { todayPacificISO, addDaysISO } from "@/lib/time";
import {
  pacificDate,
  pacificTime,
  pacificDayLabel,
  fmtDuration,
  entryMs,
} from "@/lib/timeclock";
import { clockInAction, clockOutAction, deleteEntryAction } from "./actions";
import LiveElapsed from "./LiveElapsed";
import TimeEntryEditor from "./TimeEntryEditor";

export const dynamic = "force-dynamic";

type Entry = {
  id: string;
  user_id?: string;
  clock_in: string;
  clock_out: string | null;
  edited?: boolean;
};

/** Small "Edited" pill for manually added / adjusted entries. */
function EditedTag() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50">
      Edited
    </span>
  );
}

export default async function TimeClockPage() {
  const { userId } = await requireTeamMember();
  const supabase = await createClient();

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const isAdmin = me?.role === "admin";

  const nowMs = Date.now();
  const todayP = todayPacificISO();
  const dow = new Date(`${todayP}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const weekStartP = addDaysISO(todayP, -dow);
  // Fetch a buffer day before the Pacific week start so nothing is missed
  // at the UTC boundary; precise filtering happens in JS via pacificDate.
  const since = `${addDaysISO(weekStartP, -1)}T00:00:00Z`;

  const [{ data: myRows }, { data: openRow }] = await Promise.all([
    supabase
      .from("time_entries")
      .select("id, clock_in, clock_out, edited")
      .eq("user_id", userId)
      .gte("clock_in", since)
      .order("clock_in", { ascending: false }),
    supabase
      .from("time_entries")
      .select("id, clock_in, clock_out")
      .eq("user_id", userId)
      .is("clock_out", null)
      .maybeSingle(),
  ]);

  const open = (openRow as Entry | null) ?? null;

  // My totals (today + this week), counting an open entry as running.
  let myTodayMs = 0;
  let myWeekMs = 0;
  for (const r of (myRows ?? []) as Entry[]) {
    const pd = pacificDate(r.clock_in);
    const ms = entryMs(r.clock_in, r.clock_out, nowMs);
    if (pd >= weekStartP) myWeekMs += ms;
    if (pd === todayP) myTodayMs += ms;
  }

  // My entries this week, grouped by Pacific day (newest first).
  const byDay = new Map<string, Entry[]>();
  for (const r of (myRows ?? []) as Entry[]) {
    const d = pacificDate(r.clock_in);
    if (d < weekStartP) continue;
    const arr = byDay.get(d) ?? [];
    arr.push(r);
    byDay.set(d, arr);
  }
  const dayKeys = Array.from(byDay.keys()).sort().reverse();

  // Admin review — everyone's hours this week.
  let perPersonList: {
    userId: string;
    name: string;
    weekMs: number;
    todayMs: number;
    clockedIn: boolean;
    entries: Entry[];
  }[] = [];
  if (isAdmin) {
    const { data: all } = await supabase
      .from("time_entries")
      .select("id, user_id, clock_in, clock_out, edited")
      .gte("clock_in", since);
    const teamRows = (all ?? []) as Entry[];
    const ids = Array.from(new Set(teamRows.map((r) => r.user_id!)));
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      for (const p of (profs ?? []) as any[]) {
        names.set(
          p.id,
          (p.full_name?.trim() || p.email?.split("@")[0] || "Unknown"),
        );
      }
    }
    const per = new Map<string, (typeof perPersonList)[number]>();
    // teamRows are unordered; sort newest-first so each person's entries read
    // top-down.
    teamRows.sort((a, b) => b.clock_in.localeCompare(a.clock_in));
    for (const r of teamRows) {
      const pd = pacificDate(r.clock_in);
      if (pd < weekStartP) continue;
      const ms = entryMs(r.clock_in, r.clock_out, nowMs);
      const e =
        per.get(r.user_id!) ?? {
          userId: r.user_id!,
          name: names.get(r.user_id!) ?? "Unknown",
          weekMs: 0,
          todayMs: 0,
          clockedIn: false,
          entries: [],
        };
      e.weekMs += ms;
      if (pd === todayP) e.todayMs += ms;
      if (!r.clock_out) e.clockedIn = true;
      e.entries.push(r);
      per.set(r.user_id!, e);
    }
    perPersonList = Array.from(per.values()).sort((a, b) => b.weekMs - a.weekMs);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Time clock</h1>
        <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
          {isAdmin
            ? "Review your team's clocked hours."
            : "Clock in and out and track your hours."}
        </p>
      </div>

      {/* Personal clock — stagers / lead stagers only. Admins just review. */}
      {!isAdmin && (
        <>
      {/* Clock in/out */}
      <section
        className={`border rounded-xl p-5 ${
          open
            ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50"
            : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Clock
              size={20}
              className={open ? "text-emerald-600" : "text-slate-400"}
            />
            <div>
              {open ? (
                <>
                  <div className="font-medium text-emerald-800 dark:text-emerald-300">
                    Clocked in · <LiveElapsed since={open.clock_in} />
                  </div>
                  <div className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
                    Since {pacificTime(open.clock_in)}
                  </div>
                </>
              ) : (
                <div className="font-medium text-slate-700 dark:text-slate-300">
                  Not clocked in
                </div>
              )}
            </div>
          </div>
          {open ? (
            <form action={clockOutAction} data-no-loader>
              <button className="bg-slate-900 text-white rounded-lg px-5 py-2.5 font-medium">
                Clock out
              </button>
            </form>
          ) : (
            <form action={clockInAction} data-no-loader>
              <button className="bg-emerald-600 text-white rounded-lg px-5 py-2.5 font-medium hover:bg-emerald-700">
                Clock in
              </button>
            </form>
          )}
        </div>
      </section>

      {/* My totals */}
      <section className="grid grid-cols-2 gap-3">
        <div className="bg-white dark:bg-slate-900 border rounded-xl p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Today
          </div>
          <div className="text-2xl font-semibold tabular-nums mt-1">
            {fmtDuration(myTodayMs)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border rounded-xl p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            This week
          </div>
          <div className="text-2xl font-semibold tabular-nums mt-1">
            {fmtDuration(myWeekMs)}
          </div>
        </div>
      </section>

      {/* My entries this week */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">This week</h2>
          <TimeEntryEditor
            triggerLabel="+ Add a past entry"
            triggerClassName="text-sm text-slate-700 dark:text-slate-300 hover:underline"
          />
        </div>
        {dayKeys.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No hours logged yet this week.
          </p>
        ) : (
          dayKeys.map((d) => {
            const rows = byDay.get(d)!;
            const dayMs = rows.reduce(
              (s, r) => s + entryMs(r.clock_in, r.clock_out, nowMs),
              0,
            );
            return (
              <div
                key={d}
                className="bg-white dark:bg-slate-900 border rounded-xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-slate-800/40 text-sm">
                  <span className="font-medium">{pacificDayLabel(d)}</span>
                  <span className="tabular-nums text-slate-600 dark:text-slate-400">
                    {fmtDuration(dayMs)}
                  </span>
                </div>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((r) => (
                    <li key={r.id} className="px-4 py-2.5 text-sm space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="text-slate-800 dark:text-slate-200">
                            {pacificTime(r.clock_in)} –{" "}
                            {r.clock_out ? (
                              pacificTime(r.clock_out)
                            ) : (
                              <span className="text-emerald-600 font-medium">
                                now
                              </span>
                            )}
                          </span>
                          {r.edited && <EditedTag />}
                        </span>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="tabular-nums text-slate-600 dark:text-slate-400">
                            {fmtDuration(
                              entryMs(r.clock_in, r.clock_out, nowMs),
                            )}
                          </span>
                          <form
                            data-no-loader
                            action={deleteEntryAction.bind(null, r.id)}
                          >
                            <button className="text-xs text-slate-400 hover:text-rose-600">
                              Delete
                            </button>
                          </form>
                        </div>
                      </div>
                      {r.clock_out && (
                        <TimeEntryEditor
                          entryId={r.id}
                          initialIn={r.clock_in}
                          initialOut={r.clock_out}
                          triggerLabel="Edit times"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>
        </>
      )}

      {/* Admin: team hours this week */}
      {isAdmin && (
        <section className="space-y-3">
          <h2 className="font-medium">Team hours · this week</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">
            Tap a person to view, edit, or delete their entries.
          </p>
          {perPersonList.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No hours logged by the team this week yet.
            </p>
          ) : (
            <div className="bg-white dark:bg-slate-900 border rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
              {perPersonList.map((p) => (
                <details
                  key={p.userId}
                  className="group [&_summary]:list-none [&_summary::-webkit-details-marker]:hidden"
                >
                  <summary className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <span className="flex items-center gap-2 min-w-0">
                      <svg
                        aria-hidden
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-90 shrink-0"
                      >
                        <path
                          fillRule="evenodd"
                          d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {p.name}
                      </span>
                      {p.clockedIn && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50">
                          On the clock
                        </span>
                      )}
                    </span>
                    <span className="text-sm text-right shrink-0">
                      <span className="tabular-nums font-semibold">
                        {fmtDuration(p.weekMs)}
                      </span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {fmtDuration(p.todayMs)} today
                      </span>
                    </span>
                  </summary>
                  <ul className="border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/60 dark:bg-slate-800/20">
                    {p.entries.map((r) => (
                      <li key={r.id} className="px-4 py-2.5 text-sm space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="text-slate-700 dark:text-slate-300">
                              {pacificDayLabel(pacificDate(r.clock_in))} ·{" "}
                              {pacificTime(r.clock_in)} –{" "}
                              {r.clock_out ? (
                                pacificTime(r.clock_out)
                              ) : (
                                <span className="text-emerald-600 font-medium">
                                  now
                                </span>
                              )}
                            </span>
                            {r.edited && <EditedTag />}
                          </span>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="tabular-nums text-slate-600 dark:text-slate-400">
                              {fmtDuration(
                                entryMs(r.clock_in, r.clock_out, nowMs),
                              )}
                            </span>
                            <form
                              data-no-loader
                              action={deleteEntryAction.bind(null, r.id)}
                            >
                              <button className="text-xs text-slate-400 hover:text-rose-600">
                                Delete
                              </button>
                            </form>
                          </div>
                        </div>
                        {r.clock_out && (
                          <TimeEntryEditor
                            entryId={r.id}
                            initialIn={r.clock_in}
                            initialOut={r.clock_out}
                            triggerLabel="Edit times"
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
