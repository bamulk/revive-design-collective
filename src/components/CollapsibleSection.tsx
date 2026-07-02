"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Collapsible dashboard section. Pronounced header bar (white pill with
 * a maroon accent on the chevron, drop-shadow, larger title) makes it
 * obvious where sections begin and end. Open/closed state persists in
 * localStorage per id.
 */
export default function CollapsibleSection({
  id,
  title,
  subtitle,
  right,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  subtitle?: React.ReactNode;
  /** Right-side content rendered in the header next to the chevron. */
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const storageKey = `dashboard.${id}.open`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "0") el.open = false;
      if (stored === "1") el.open = true;
    } catch {
      // localStorage can throw in private browsing — ignore.
    }
  }, [storageKey]);

  function onToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    try {
      localStorage.setItem(storageKey, e.currentTarget.open ? "1" : "0");
    } catch {
      // ignore
    }
  }

  return (
    <details
      ref={ref}
      open={defaultOpen}
      onToggle={onToggle}
      className="group [&_summary]:list-none [&_summary::-webkit-details-marker]:hidden"
    >
      <summary
        className="
          flex items-center justify-between gap-3
          cursor-pointer select-none
          bg-white dark:bg-slate-900 border rounded-xl shadow-sm
          px-4 sm:px-5 py-3.5
          hover:border-slate-300 dark:border-slate-600 hover:shadow
          group-open:rounded-b-none group-open:border-b-0
          transition
        "
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="
              inline-flex items-center justify-center
              w-8 h-8 rounded-lg
              bg-amber-50 text-brand
              ring-1 ring-amber-100
              transition-transform duration-150
              -rotate-90 group-open:rotate-0
            "
          >
            <ChevronDown size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 truncate leading-tight">
              {title}
            </h2>
            {subtitle && (
              <div className="text-xs text-slate-600 dark:text-slate-400 truncate mt-0.5">
                {subtitle}
              </div>
            )}
          </div>
        </div>
        {right && (
          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            {right}
          </div>
        )}
      </summary>
      <div
        className="
          bg-white dark:bg-slate-900 border border-t-0
          rounded-b-xl
          px-4 sm:px-5 py-4
          space-y-3
        "
      >
        {children}
      </div>
    </details>
  );
}
