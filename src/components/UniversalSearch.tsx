"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Search, X, Loader2, Home, FileSignature, User } from "lucide-react";
import {
  universalSearchAction,
  type SearchHit,
} from "@/app/(app)/search/actions";

const TYPE_META: Record<
  SearchHit["type"],
  { Icon: typeof Home; label: string; chip: string }
> = {
  stage: {
    Icon: Home,
    label: "Stage",
    chip: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
  },
  estimate: {
    Icon: FileSignature,
    label: "Estimate",
    chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  client: {
    Icon: User,
    label: "Client",
    chip: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
};

// Order + plural labels for the grouped result sections.
const GROUP_ORDER: SearchHit["type"][] = ["stage", "estimate", "client"];
const GROUP_LABEL: Record<SearchHit["type"], string> = {
  stage: "Stages",
  estimate: "Estimates",
  client: "Clients",
};

/**
 * Universal search: a header icon that opens a command-palette modal
 * searching stages, estimates, and clients. Debounced; results link
 * straight to the record.
 *
 * The modal stays mounted (just hidden) so the input can be focused
 * synchronously inside the tap gesture — required for iOS to raise the
 * keyboard on open.
 */
export default function UniversalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Portal target only exists on the client.
  useEffect(() => setMounted(true), []);

  function openSearch() {
    // Focus WHILE handling the tap (input is already mounted) so iOS
    // brings up the keyboard; then reveal the modal.
    inputRef.current?.focus();
    setOpen(true);
  }

  // Clear when closed.
  useEffect(() => {
    if (!open) {
      setQ("");
      setHits([]);
    }
  }, [open]);

  // Close on route change (after picking a result).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await universalSearchAction(term);
        if (!cancelled) setHits(r);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const showHint = q.trim().length < 2;

  return (
    <>
      <button
        type="button"
        onClick={openSearch}
        aria-label="Search"
        className="inline-flex items-center justify-center w-9 h-9 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition"
      >
        <Search size={18} />
      </button>

      {/* Full-screen search, portaled to <body> so the header's
          backdrop-blur (which makes it a containing block for fixed
          descendants) can't trap/clip it. Always mounted so the input
          can be focused inside the tap (raises the iOS keyboard). */}
      {mounted &&
        createPortal(
          <div
            className={`fixed inset-0 z-[1300] bg-white dark:bg-slate-900 flex flex-col transition-opacity duration-150 ${
              open ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
        role="dialog"
        aria-modal="true"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {/* Search bar */}
        <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-100 dark:border-slate-800">
          <Search
            size={18}
            className="ml-1 text-slate-400 dark:text-slate-500 shrink-0"
          />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search stages, estimates, clients…"
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            tabIndex={open ? 0 : -1}
            className="flex-1 bg-transparent text-base sm:text-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none border-0 p-0"
          />
          {loading ? (
            <Loader2 size={16} className="animate-spin text-slate-400 shrink-0" />
          ) : q ? (
            <button
              type="button"
              onClick={() => {
                setQ("");
                inputRef.current?.focus();
              }}
              aria-label="Clear"
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
            >
              <X size={18} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="shrink-0 px-2 py-1 text-sm font-medium text-brand"
          >
            Cancel
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto py-1.5">
          {showHint ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
              Search by address, city, or client name.
            </p>
          ) : hits.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
              {loading ? "Searching…" : "No matches."}
            </p>
          ) : (
            GROUP_ORDER.map((type) => {
              const group = hits.filter((h) => h.type === type);
              if (group.length === 0) return null;
              return (
                <div key={type} className="pb-1">
                  <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {GROUP_LABEL[type]}
                  </div>
                  {group.map((h) => {
                    const { Icon, chip } = TYPE_META[h.type];
                    return (
                      <button
                        key={`${h.type}-${h.id}`}
                        type="button"
                        onClick={() => router.push(h.href)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        <span
                          className={`inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0 ${chip}`}
                        >
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                            {h.title}
                          </span>
                          {h.subtitle && (
                            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                              {h.subtitle}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
          </div>,
          document.body,
        )}
    </>
  );
}
