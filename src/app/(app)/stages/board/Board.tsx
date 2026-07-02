"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CheckSquare, Search, X } from "lucide-react";
import { updateStageStatusAction } from "../actions";

export type BoardStage = {
  id: string;
  address: string;
  client_name: string | null;
  amount: number;
  status: string;
  stage_date: string | null;
  destage_date: string | null;
  thumb_url: string | null;
  tasks_done: number;
  tasks_total: number;
};

const COLUMNS: { key: string; label: string; accent: string }[] = [
  { key: "scheduled", label: "Upcoming", accent: "bg-blue-50 border-blue-200" },
  { key: "staged", label: "Staged", accent: "bg-amber-50 border-amber-200" },
  { key: "destaged", label: "Destages", accent: "bg-violet-50 border-violet-200" },
  { key: "completed", label: "Completed", accent: "bg-emerald-50 border-emerald-200" },
];

export default function Board({ initialStages }: { initialStages: BoardStage[] }) {
  const [stages, setStages] = useState(initialStages);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [, startTransition] = useTransition();

  // Separate sensors per input so we can tune them independently:
  // - Mouse: drag starts after the pointer moves 4px (lets clicks pass through)
  // - Touch: a 200ms press-and-hold is required before we claim the gesture,
  //   which lets a quick tap navigate via the wrapping <Link>, and pre-empts
  //   Safari's long-press context menu by starting the drag first.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  );

  // Filter by address or client name. Splits the query on whitespace and
  // requires every token to appear somewhere in the haystack — so "main
  // smith" matches "123 Main St" if the client is "Smith".
  const visibleStages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stages;
    const tokens = q.split(/\s+/);
    return stages.filter((s) => {
      const hay = `${s.address ?? ""} ${s.client_name ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [stages, query]);
  const matchCount = visibleStages.length;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const stageId = String(e.active.id);
    const targetStatus = e.over?.id ? String(e.over.id) : null;
    if (!targetStatus) return;
    const current = stages.find((s) => s.id === stageId);
    if (!current || current.status === targetStatus) return;

    // Optimistic update
    setStages((prev) =>
      prev.map((s) => (s.id === stageId ? { ...s, status: targetStatus } : s))
    );
    startTransition(async () => {
      try {
        await updateStageStatusAction(stageId, targetStatus);
      } catch (err) {
        // revert on failure
        setStages((prev) =>
          prev.map((s) => (s.id === stageId ? { ...s, status: current.status } : s))
        );
        console.error(err);
      }
    });
  }

  const active = activeId ? stages.find((s) => s.id === activeId) : null;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {/* Search bar */}
      <div className="mb-4 flex items-center gap-2">
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
            {matchCount} match{matchCount === 1 ? "" : "es"}
          </span>
        )}
      </div>

      {/* Mobile: horizontal snap scroll. Desktop: grid */}
      <div className="-mx-4 sm:mx-0 overflow-x-auto sm:overflow-visible snap-x snap-mandatory sm:snap-none">
        <div className="flex sm:grid sm:grid-cols-2 lg:grid-cols-5 gap-4 px-4 sm:px-0">
          {COLUMNS.map((col) => {
            const colStages = visibleStages.filter((s) => s.status === col.key);
            return (
              <div
                key={col.key}
                className="snap-center flex-none w-[85%] sm:w-auto"
              >
                <Column id={col.key} label={col.label} accent={col.accent} count={colStages.length}>
                  {colStages.map((s) => (
                    <DraggableCard key={s.id} stage={s} />
                  ))}
                  {colStages.length === 0 && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 italic p-3 text-center">
                      {query ? "No matches" : "Drop here"}
                    </div>
                  )}
                </Column>
              </div>
            );
          })}
        </div>
      </div>
      <DragOverlay>{active ? <Card stage={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({
  id,
  label,
  accent,
  count,
  children,
}: {
  id: string;
  label: string;
  accent: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border ${accent} ${
        isOver ? "ring-2 ring-slate-900/30" : ""
      } flex flex-col h-[70vh] sm:h-[calc(100svh-14rem)] max-h-[calc(100svh-10rem)]`}
    >
      {/* Sticky-ish header — stays put as cards scroll past it. */}
      <div className="shrink-0 px-3 py-2 flex items-center justify-between border-b border-inherit bg-inherit rounded-t-xl">
        <h2 className="font-semibold text-sm text-slate-900 dark:text-slate-100">{label}</h2>
        <span className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900/70 rounded px-1.5">
          {count}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {children}
      </div>
    </div>
  );
}

function DraggableCard({ stage }: { stage: BoardStage }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`${isDragging ? "opacity-30" : ""} select-none`}
      // Suppress Safari's long-press preview/menu, but allow the browser
      // to handle vertical pan so the user can scroll a tall column by
      // swiping on the cards themselves. dnd-kit's TouchSensor still
      // claims the gesture after a 200ms press-and-hold; a quick vertical
      // swipe escapes the activation tolerance and falls through to the
      // browser's native scroll.
      style={{
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        touchAction: "pan-y",
      }}
    >
      <Card stage={stage} />
    </div>
  );
}

function Card({ stage, dragging = false }: { stage: BoardStage; dragging?: boolean }) {
  const inner = (
    <div
      className={`bg-white dark:bg-slate-900 rounded-lg border overflow-hidden shadow-sm ${
        dragging ? "shadow-lg rotate-2" : "hover:shadow"
      } cursor-grab active:cursor-grabbing`}
    >
      {stage.thumb_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={stage.thumb_url} alt="" loading="lazy" className="w-full h-24 object-cover bg-slate-100 dark:bg-slate-800" />
      ) : (
        <div className="w-full h-24 bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs">
          No photo
        </div>
      )}
      <div className="p-2.5 space-y-1.5">
        <div className="font-medium text-sm text-slate-900 dark:text-slate-100 line-clamp-2">
          {stage.address}
        </div>
        {stage.client_name && (
          <div className="text-xs text-slate-700 dark:text-slate-300">{stage.client_name}</div>
        )}
        {stage.tasks_total > 0 && (
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <CheckSquare size={11} />
                {stage.tasks_done}/{stage.tasks_total}
              </span>
              <span className="tabular-nums">
                {Math.round((stage.tasks_done / stage.tasks_total) * 100)}%
              </span>
            </div>
            <div className="h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-gold to-brand"
                style={{
                  width: `${(stage.tasks_done / stage.tasks_total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
        <div className="flex items-center gap-1 text-xs pt-0.5">
          <DatePill date={stage.stage_date} />
          {stage.destage_date && (
            <>
              <span className="text-slate-400 dark:text-slate-500">→</span>
              <DatePill date={stage.destage_date} />
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (dragging) return inner;

  return (
    <Link
      href={`/stages/${stage.id}`}
      onClick={(e) => e.stopPropagation()}
      draggable={false}
      style={{
        WebkitTouchCallout: "none",
        WebkitUserDrag: "none",
      } as React.CSSProperties}
    >
      {inner}
    </Link>
  );
}

function DatePill({ date }: { date: string | null }) {
  if (!date) {
    return <span className="text-slate-400 dark:text-slate-500">—</span>;
  }

  // Compare ISO date strings (YYYY-MM-DD) so timezones don't muddy the result.
  const today = new Date();
  const todayStr =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  let tone: string;
  if (date === todayStr) {
    tone = "bg-emerald-50 text-emerald-700 ring-emerald-200";
  } else if (date < todayStr) {
    tone = "bg-rose-50 text-rose-700 ring-rose-200";
  } else {
    tone = "bg-amber-50 text-amber-800 ring-amber-200";
  }

  // mm/dd/yy — same format used by every other date pill in the app.
  const [y, m, d] = date.split("-").map(Number);
  const label = `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${String(y).slice(-2)}`;

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium ring-1 ring-inset tabular-nums ${tone}`}
    >
      {label}
    </span>
  );
}
