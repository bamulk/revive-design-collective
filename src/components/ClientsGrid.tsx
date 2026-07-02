"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Mail, Phone, User, Search, X } from "lucide-react";

export type ClientCard = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  stageCount: number;
};

/**
 * Searchable, alphabetically-sorted grid of client cards. Filter runs
 * client-side over the full set the server already shipped, so no
 * round-trips per keystroke.
 */
export default function ClientsGrid({ clients }: { clients: ClientCard[] }) {
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    const tokens = q.split(/\s+/);
    return clients.filter((c) => {
      const hay = `${c.name} ${c.email ?? ""} ${c.phone ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [clients, query]);

  return (
    <div className="space-y-4">
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
            placeholder="Search by name, email, or phone…"
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
        <span className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
          {visible.length} / {clients.length}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="text-center text-sm text-slate-500 dark:text-slate-400 italic p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl">
          {query ? "No clients match that search." : "No clients yet."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map((c) => {
            const initials = c.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((p: string) => p[0]?.toUpperCase() ?? "")
              .join("");
            return (
              <Link
                key={c.id}
                href={`/clients/${c.id}`}
                className="group bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm hover:shadow hover:border-slate-300 dark:border-slate-600 active:bg-slate-50 dark:bg-slate-900 transition flex items-start gap-3"
              >
                <span className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-50 text-brand ring-1 ring-amber-100 text-sm font-semibold">
                  {initials || <User size={16} />}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate group-hover:text-brand">
                      {c.name}
                    </div>
                    <span className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {c.stageCount} stage{c.stageCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 space-y-0.5">
                    {c.email && (
                      <div className="inline-flex items-center gap-1.5 truncate max-w-full">
                        <Mail size={11} className="text-slate-400 dark:text-slate-500 shrink-0" />
                        <span className="truncate">{c.email}</span>
                      </div>
                    )}
                    {c.phone && (
                      <div className="inline-flex items-center gap-1.5">
                        <Phone size={11} className="text-slate-400 dark:text-slate-500 shrink-0" />
                        <span>{c.phone}</span>
                      </div>
                    )}
                    {!c.email && !c.phone && (
                      <span className="text-slate-400 dark:text-slate-500 italic">
                        No contact info
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
