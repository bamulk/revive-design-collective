"use client";

import { useEffect, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { updatePhotographerAtAction } from "@/app/(app)/stages/actions";

/** ISO/UTC -> value for <input type="datetime-local"> in local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtCountdown(ms: number): string {
  const past = ms < 0;
  const totalMin = Math.floor(Math.abs(ms) / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const core = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return past ? `${core} ago` : `in ${core}`;
}

/**
 * Photographer-arrival box on the stage page: the staging work has to
 * be DONE before this date/time. Every team member sees it with a live
 * countdown (amber inside 24h, red once it's passed); admins can set,
 * change, or clear it inline. Hidden entirely for non-admins when no
 * time is set.
 */
export default function PhotographerBox({
  stageId,
  photographerAt,
  canEdit,
}: {
  stageId: string;
  photographerAt: string | null;
  canEdit: boolean;
}) {
  const [current, setCurrent] = useState<string | null>(photographerAt);
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(() => toLocalInput(photographerAt));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Countdown ticks client-side only (null until mounted) so the
  // server-rendered HTML never disagrees with the first client paint.
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setCurrent(photographerAt);
    setInputVal(toLocalInput(photographerAt));
  }, [photographerAt]);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!current && !canEdit) return null;

  async function save(nextIso: string | null) {
    setError(null);
    setPending(true);
    try {
      const r = await updatePhotographerAtAction(stageId, nextIso);
      if (r.ok) {
        setCurrent(nextIso);
        setEditing(false);
      } else {
        setError(r.error);
      }
    } catch {
      setError("Couldn't save. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const msLeft =
    current && now ? new Date(current).getTime() - now.getTime() : null;
  const pillTone =
    msLeft == null
      ? ""
      : msLeft < 0
        ? "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:ring-rose-900/60"
        : msLeft < 24 * 60 * 60 * 1000
          ? "bg-amber-100 text-amber-800 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900/60"
          : "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900/60";

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
            <Camera size={15} />
          </span>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Photographer
            </div>
            {current ? (
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {fmtWhen(current)}
              </div>
            ) : (
              <div className="text-sm text-slate-500 dark:text-slate-400 italic">
                Not scheduled
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {current && msLeft != null && (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset tabular-nums ${pillTone}`}
              title="Time until the photographer arrives — staging must be done first"
            >
              {msLeft < 0
                ? `Passed ${fmtCountdown(msLeft)}`
                : fmtCountdown(msLeft)}
            </span>
          )}
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setInputVal(toLocalInput(current));
                setEditing(true);
              }}
              className="text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 underline decoration-dotted underline-offset-2"
            >
              {current ? "Edit" : "Set date & time"}
            </button>
          )}
        </div>
      </div>

      {canEdit && editing && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            type="datetime-local"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            disabled={pending}
            className="border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm bg-white dark:bg-slate-900"
          />
          <button
            type="button"
            onClick={() => {
              if (!inputVal) return;
              void save(new Date(inputVal).toISOString());
            }}
            disabled={pending || !inputVal}
            className="inline-flex items-center gap-1.5 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-lg px-3 py-2 text-xs disabled:opacity-60"
          >
            {pending ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Saving…
              </>
            ) : (
              "Save"
            )}
          </button>
          {current && (
            <button
              type="button"
              onClick={() => void save(null)}
              disabled={pending}
              className="text-xs text-rose-700 dark:text-rose-300 hover:underline disabled:opacity-60"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            disabled={pending}
            className="text-xs text-slate-600 dark:text-slate-400 hover:underline disabled:opacity-60"
          >
            Cancel
          </button>
          {error && (
            <span className="w-full text-xs text-rose-700">{error}</span>
          )}
        </div>
      )}
    </div>
  );
}
