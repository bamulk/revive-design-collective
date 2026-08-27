"use client";

import { useState, useTransition } from "react";
import { Plus, X, Loader2, CalendarPlus } from "lucide-react";
import {
  createCalendarEventAction,
  deleteCalendarEventAction,
} from "./actions";
import type { CalendarEvent } from "./CalendarView";

/**
 * Admin-only panel for the manual (non-stage) calendar entries —
 * holidays, warehouse days, vacations. Collapsed by default so it
 * doesn't compete with the calendar itself.
 */
export default function CalendarEventsAdmin({
  events,
}: {
  events: CalendarEvent[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Past entries stay on the calendar but clutter this list — show
  // today onward.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events
    .filter((e) => (e.end_date ?? e.event_date) >= today)
    .slice(0, 12);

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createCalendarEventAction({
        title,
        eventDate: date,
        endDate: endDate || null,
        note: note || null,
      });
      if (r.ok) {
        setTitle("");
        setDate("");
        setEndDate("");
        setNote("");
        setOpen(false);
      } else setError(r.error);
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await deleteCalendarEventAction(id);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <section className="bg-white dark:bg-slate-900 border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarPlus size={15} className="text-slate-500" />
          <h2 className="font-medium text-sm">Calendar entries</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Holidays, warehouse days, time off
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          {open ? <X size={14} /> : <Plus size={14} />}
          {open ? "Cancel" : "Add entry"}
        </button>
      </div>

      {open && (
        <form onSubmit={add} className="space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title — e.g. Warehouse inventory day"
            className="w-full border rounded-lg px-3 py-2 text-sm"
            required
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block text-xs text-slate-600 dark:text-slate-400">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
                required
              />
            </label>
            <label className="block text-xs text-slate-600 dark:text-slate-400">
              End date (optional)
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={date || undefined}
                className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full border rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-60"
            style={{ background: "var(--brand)" }}
          >
            {pending && <Loader2 size={14} className="animate-spin" />}
            Add to calendar
          </button>
        </form>
      )}

      {upcoming.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
          {upcoming.map((e) => (
            <li key={e.id} className="flex items-center gap-2 py-1.5">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-brand" />
              <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                {e.title}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                {e.event_date}
                {e.end_date && e.end_date !== e.event_date
                  ? ` → ${e.end_date}`
                  : ""}
              </span>
              <button
                type="button"
                onClick={() => remove(e.id)}
                disabled={pending}
                aria-label={`Remove ${e.title}`}
                className="ml-auto shrink-0 text-slate-400 hover:text-rose-600 disabled:opacity-50"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </section>
  );
}
