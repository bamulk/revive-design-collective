"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { Check, Trash2, Plus } from "lucide-react";
import { addTaskAction, toggleTaskAction, deleteTaskAction } from "./actions";

export type Task = {
  id: string;
  title: string;
  is_done: boolean;
  position: number;
};

type OptimisticAction =
  | { type: "add"; task: Task }
  | { type: "toggle"; id: string; is_done: boolean }
  | { type: "delete"; id: string };

export default function Checklist({
  stageId,
  initialTasks,
}: {
  stageId: string;
  initialTasks: Task[];
}) {
  const [newTitle, setNewTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();

  const [tasks, applyOptimistic] = useOptimistic<Task[], OptimisticAction>(
    initialTasks,
    (state, action) => {
      switch (action.type) {
        case "add":
          return [...state, action.task];
        case "toggle":
          return state.map((t) =>
            t.id === action.id ? { ...t, is_done: action.is_done } : t
          );
        case "delete":
          return state.filter((t) => t.id !== action.id);
      }
    }
  );

  const done = tasks.filter((t) => t.is_done).length;
  const total = tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    inputRef.current?.focus();

    const fd = new FormData();
    fd.set("title", title);

    startTransition(async () => {
      applyOptimistic({
        type: "add",
        task: {
          id: `temp-${Date.now()}`,
          title,
          is_done: false,
          position: (tasks.at(-1)?.position ?? 0) + 1,
        },
      });
      await addTaskAction(stageId, fd);
    });
  }

  function handleToggle(task: Task) {
    const next = !task.is_done;
    startTransition(async () => {
      applyOptimistic({ type: "toggle", id: task.id, is_done: next });
      await toggleTaskAction(stageId, task.id, next);
    });
  }

  function handleDelete(task: Task) {
    startTransition(async () => {
      applyOptimistic({ type: "delete", id: task.id });
      await deleteTaskAction(stageId, task.id);
    });
  }

  return (
    <div className="space-y-3">
      {total > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span>
              {done} of {total} complete
            </span>
            <span className="font-medium tabular-nums">{pct}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-gold to-brand rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <ul className="space-y-1">
        {tasks.map((t) => (
          <li
            key={t.id}
            className="group flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            <button
              type="button"
              onClick={() => handleToggle(t)}
              className="relative w-11 h-11 -m-3 flex-none inline-flex items-center justify-center"
              aria-label={t.is_done ? "Mark incomplete" : "Mark complete"}
            >
              <span
                className={`w-6 h-6 rounded border inline-flex items-center justify-center transition ${
                  t.is_done
                    ? "bg-brand border-brand text-white"
                    : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600"
                }`}
              >
                {t.is_done && <Check size={14} strokeWidth={3} />}
              </span>
            </button>
            <span
              className={`flex-1 text-sm ${
                t.is_done ? "text-slate-400 dark:text-slate-500 line-through" : "text-slate-900 dark:text-slate-100"
              }`}
            >
              {t.title}
            </span>
            <button
              type="button"
              onClick={() => handleDelete(t)}
              className="sm:opacity-0 sm:group-hover:opacity-100 text-slate-400 dark:text-slate-500 hover:text-red-600 p-2 -m-1"
              aria-label="Delete task"
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
        {tasks.length === 0 && (
          <li className="text-sm text-slate-500 dark:text-slate-400 italic px-2 py-1">
            No tasks yet — add the first one below.
          </li>
        )}
      </ul>

      <form onSubmit={handleAdd} className="flex items-center gap-2 pt-1">
        <input
          ref={inputRef}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a task…"
          className="flex-1 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-base"
        />
        <button
          type="submit"
          disabled={!newTitle.trim() || isPending}
          className="inline-flex items-center gap-1 text-sm bg-slate-900 text-white rounded-lg px-4 py-2.5 disabled:opacity-40"
        >
          <Plus size={14} /> Add
        </button>
      </form>
    </div>
  );
}
