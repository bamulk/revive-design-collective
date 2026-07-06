"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { markPaidAction } from "@/app/(app)/stages/actions";

const METHODS = [
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "zelle", label: "Zelle" },
  { value: "venmo", label: "Venmo" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];

function todayISO(): string {
  // Pacific-anchored — server runs in UTC and would jump us to
  // 'tomorrow' after 4-5 PM PT otherwise.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value || "0000";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const d = parts.find((p) => p.type === "day")?.value || "01";
  return `${y}-${m}-${d}`;
}

/**
 * Inline "method + paid-on + Mark paid" form for the dashboard's
 * unpaid-invoice list. Method + date are both editable so the admin
 * can backdate a payment that came in by mail / Zelle without
 * navigating into the stage detail page.
 */
export default function QuickMarkPaid({ stageId }: { stageId: string }) {
  const [method, setMethod] = useState("check");
  const [paidDate, setPaidDate] = useState(todayISO());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    const fd = new FormData();
    fd.set("method", method);
    fd.set("paid_at", paidDate);
    startTransition(async () => {
      const r = await markPaidAction(stageId, fd);
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value)}
        disabled={pending}
        aria-label="Payment method"
        className="border rounded px-2 py-1 text-xs"
      >
        {METHODS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={paidDate}
        onChange={(e) => setPaidDate(e.target.value)}
        disabled={pending}
        aria-label="Payment date"
        className="border rounded px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2 py-1 disabled:opacity-60"
        title={error ?? "Mark as paid"}
      >
        {pending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Check size={12} />
        )}
        Mark as paid
      </button>
      {/* Visible error — a tooltip-only error is invisible on touch
          devices, which made failures look like the button did nothing. */}
      {error && (
        <span className="w-full text-[11px] text-rose-700 leading-tight">
          {error}
        </span>
      )}
    </div>
  );
}
