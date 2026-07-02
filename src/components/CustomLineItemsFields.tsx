"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { type LineItem } from "@/lib/pricing";

/**
 * Repeatable custom line items (description + price) for the pricing
 * section of the new/edit estimate + stage forms. These are ad-hoc
 * charges on top of (or instead of) a catalog package — each one shows
 * on the estimate, the contract, and the invoice.
 *
 * Emits a single hidden field `line_items` containing a JSON array of
 * `{ description, price }`. Server-side parseLineItems() re-validates it
 * and folds the prices into the saved amount.
 */
export default function CustomLineItemsFields({
  defaultItems = [],
}: {
  defaultItems?: LineItem[];
}) {
  const [rows, setRows] = useState<{ description: string; price: string }[]>(
    () =>
      defaultItems.length
        ? defaultItems.map((i) => ({
            description: i.description,
            price: String(i.price),
          }))
        : [],
  );

  function update(i: number, patch: Partial<{ description: string; price: string }>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function add() {
    setRows((prev) => [...prev, { description: "", price: "" }]);
  }
  function remove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Only well-formed rows are submitted; the server re-validates anyway.
  const payload = rows
    .map((r) => ({ description: r.description.trim(), price: Number(r.price) }))
    .filter(
      (r) =>
        r.description.length > 0 &&
        Number.isFinite(r.price) &&
        r.price >= 0,
    );
  const subtotal = payload.reduce((s, r) => s + r.price, 0);

  const input =
    "border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-base bg-white dark:bg-slate-900";

  return (
    <div className="space-y-2">
      <input type="hidden" name="line_items" value={JSON.stringify(payload)} />

      <div>
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Custom line items
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Add any extra charge with its own description and price. Each one
          appears on the estimate, the contract, and the invoice.
        </p>
      </div>

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={r.description}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder="Description (e.g. Extra week of storage)"
                maxLength={200}
                className={`${input} flex-1 min-w-0`}
              />
              <div className="relative shrink-0">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                  $
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={r.price}
                  onChange={(e) => update(i, { price: e.target.value })}
                  placeholder="0.00"
                  className={`${input} w-28 pl-5`}
                />
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove line item"
                className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-sm text-brand hover:text-brand-hover"
        >
          <Plus size={14} /> Add line item
        </button>
        {payload.length > 0 && (
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            Line items: $
            {subtotal.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        )}
      </div>
    </div>
  );
}
