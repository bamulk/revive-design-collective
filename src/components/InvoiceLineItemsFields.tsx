"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  fmtMoney,
  type InvoiceLineItem,
} from "@/lib/custom-invoice";

type Row = { description: string; qty: string; unit_price: string };

/**
 * Line items for a standalone invoice: description × qty @ unit price.
 * Emits one hidden field `line_items` as JSON; the server re-parses and
 * recomputes every amount, so the client-side math is display only.
 */
export default function InvoiceLineItemsFields({
  defaultItems = [],
  defaultDiscount = 0,
}: {
  defaultItems?: InvoiceLineItem[];
  defaultDiscount?: number;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    defaultItems.length
      ? defaultItems.map((i) => ({
          description: i.description,
          qty: String(i.qty),
          unit_price: String(i.unit_price),
        }))
      : [{ description: "", qty: "1", unit_price: "" }],
  );
  const [discount, setDiscount] = useState(
    defaultDiscount > 0 ? String(defaultDiscount) : "",
  );

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function add() {
    setRows((prev) => [...prev, { description: "", qty: "1", unit_price: "" }]);
  }
  function remove(i: number) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  const payload = rows
    .map((r) => {
      const qty = Number(r.qty);
      const unit = Number(r.unit_price);
      return {
        description: r.description.trim(),
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        unit_price: Number.isFinite(unit) && unit >= 0 ? unit : NaN,
      };
    })
    .filter((r) => r.description.length > 0 && Number.isFinite(r.unit_price));
  const subtotal = payload.reduce((s, r) => s + r.qty * r.unit_price, 0);
  const disc = Number(discount);
  const total = Math.max(subtotal - (Number.isFinite(disc) && disc > 0 ? disc : 0), 0);

  const input =
    "border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-base bg-white dark:bg-slate-900";

  return (
    <div className="space-y-3">
      <input type="hidden" name="line_items" value={JSON.stringify(payload)} />

      <div>
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Line items *
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          One row per charge. Quantity × unit price is shown on the PDF when
          it isn&rsquo;t just 1.
        </p>
      </div>

      <div className="space-y-2">
        {/* Column labels — hidden on phones where rows stack */}
        <div className="hidden sm:grid sm:grid-cols-12 gap-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 px-0.5">
          <div className="sm:col-span-6">Description</div>
          <div className="sm:col-span-2">Qty</div>
          <div className="sm:col-span-3">Unit price</div>
          <div className="sm:col-span-1" />
        </div>
        {rows.map((r, i) => {
          const qty = Number(r.qty);
          const unit = Number(r.unit_price);
          const amt =
            Number.isFinite(qty) && Number.isFinite(unit) && r.unit_price !== ""
              ? qty * unit
              : null;
          return (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input
                type="text"
                value={r.description}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder={
                  i === 0 ? "e.g. Deep clean after destage" : "Description"
                }
                maxLength={200}
                className={`${input} col-span-12 sm:col-span-6`}
              />
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0.01"
                value={r.qty}
                onChange={(e) => update(i, { qty: e.target.value })}
                aria-label="Quantity"
                className={`${input} col-span-3 sm:col-span-2 tabular-nums`}
              />
              <div className="relative col-span-6 sm:col-span-3">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
                  $
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={r.unit_price}
                  onChange={(e) => update(i, { unit_price: e.target.value })}
                  placeholder="0.00"
                  aria-label="Unit price"
                  className={`${input} w-full pl-5 tabular-nums`}
                />
              </div>
              <div className="col-span-3 sm:col-span-1 flex items-center justify-end gap-1">
                <span className="sm:hidden text-xs text-slate-500 tabular-nums">
                  {amt !== null ? fmtMoney(amt) : ""}
                </span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={rows.length === 1}
                  aria-label="Remove line item"
                  className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1 text-sm text-brand hover:text-brand-hover"
      >
        <Plus size={14} /> Add line item
      </button>

      <div className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600 dark:text-slate-400">Subtotal</span>
          <span className="tabular-nums">{fmtMoney(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <label htmlFor="invoice-discount" className="text-slate-600 dark:text-slate-400">
            Discount
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
              $
            </span>
            <input
              id="invoice-discount"
              name="discount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              placeholder="0.00"
              className={`${input} w-32 pl-5 tabular-nums text-sm py-1.5`}
            />
          </div>
        </div>
        <div className="flex items-center justify-between text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{fmtMoney(total)}</span>
        </div>
      </div>
    </div>
  );
}
