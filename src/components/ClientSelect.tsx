"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UserPlus, Search, X, Check, ChevronDown } from "lucide-react";
import ImportContactButton from "./ImportContactButton";

type ClientOption = { id: string; name: string; email?: string | null };

/**
 * Client-picker with a toggle to create a new client inline.
 *
 * Existing mode renders a custom searchable combobox (a hidden
 * <input name="client_id"> is what the form actually posts so the
 * server action sees the same field name as before). The native
 * <select> was unusable on a list of 250+ clients because iOS would
 * just dump the whole list with no incremental filtering.
 *
 * Emits either:
 *   - `client_id` (existing selection), or
 *   - `new_client_name` / `new_client_email` / `new_client_phone` (inline create)
 */
export default function ClientSelect({
  clients,
  defaultClientId,
}: {
  clients: ClientOption[];
  defaultClientId?: string;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedId, setSelectedId] = useState<string>(defaultClientId ?? "");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // Controlled state for the inline-create block so the "Import from
  // contact card" button can fill these fields programmatically.
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => clients.find((c) => c.id === selectedId) ?? null,
    [clients, selectedId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    const tokens = q.split(/\s+/);
    return clients.filter((c) => {
      const hay = `${c.name} ${c.email ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [clients, query]);

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // When the dropdown opens, focus the search box.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">Client *</span>
        <button
          type="button"
          onClick={() => setMode(mode === "existing" ? "new" : "existing")}
          className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-hover"
        >
          {mode === "existing" ? (
            <>
              <UserPlus size={13} /> New client
            </>
          ) : (
            <>Use existing</>
          )}
        </button>
      </div>

      {mode === "existing" ? (
        <div ref={wrapperRef} className="relative">
          {/* The actual posted value */}
          <input type="hidden" name="client_id" value={selectedId} required />

          {/* Trigger button — shows the selected client or a placeholder */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={`w-full inline-flex items-center justify-between gap-2 border rounded px-3 py-2.5 text-base bg-white dark:bg-slate-900 text-left ${
              selected ? "text-slate-900 dark:text-slate-100" : "text-slate-400 dark:text-slate-500"
            }`}
          >
            <span className="truncate">
              {selected ? (
                <>
                  {selected.name}
                  {selected.email ? (
                    <span className="text-slate-500 dark:text-slate-400">
                      {" "}
                      ({selected.email})
                    </span>
                  ) : null}
                </>
              ) : (
                "Select client…"
              )}
            </span>
            <ChevronDown
              size={16}
              className={`text-slate-500 dark:text-slate-400 shrink-0 transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>

          {open && (
            <div className="absolute z-30 mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg overflow-hidden">
              {/* Search input */}
              <div className="relative p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
                <Search
                  size={14}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search clients…"
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded pl-7 pr-7 py-1.5 text-sm"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              {/* Results list — capped height with scroll. */}
              <ul
                role="listbox"
                className="max-h-72 overflow-y-auto py-1"
              >
                {filtered.length === 0 ? (
                  <li className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400 italic">
                    No clients match
                  </li>
                ) : (
                  filtered.slice(0, 200).map((c) => {
                    const isSel = c.id === selectedId;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSel}
                          onClick={() => {
                            setSelectedId(c.id);
                            setOpen(false);
                            setQuery("");
                          }}
                          className={`w-full text-left flex items-center gap-2 px-3 py-2 text-sm ${
                            isSel
                              ? "bg-amber-50 text-brand font-medium"
                              : "text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900"
                          }`}
                        >
                          <Check
                            size={14}
                            className={isSel ? "text-brand" : "opacity-0"}
                          />
                          <span className="truncate">
                            {c.name}
                            {c.email ? (
                              <span className="text-slate-500 dark:text-slate-400">
                                {" "}
                                ({c.email})
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
                {filtered.length > 200 && (
                  <li className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 text-center border-t border-slate-100 dark:border-slate-800">
                    Showing first 200 of {filtered.length} — keep typing
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
          <ImportContactButton
            onImport={({ name, email, phone }) => {
              if (name) setNewName(name);
              if (email) setNewEmail(email);
              if (phone) setNewPhone(phone);
            }}
          />
          <input
            name="new_client_name"
            required
            placeholder="Client name *"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full border rounded px-3 py-2.5 text-base bg-white dark:bg-slate-900"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              name="new_client_email"
              type="email"
              inputMode="email"
              placeholder="Email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="w-full border rounded px-3 py-2.5 text-base bg-white dark:bg-slate-900"
            />
            <input
              name="new_client_phone"
              type="tel"
              inputMode="tel"
              placeholder="Phone"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              className="w-full border rounded px-3 py-2.5 text-base bg-white dark:bg-slate-900"
            />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            A new client record will be created when you save the stage.
          </p>
        </div>
      )}
    </div>
  );
}
