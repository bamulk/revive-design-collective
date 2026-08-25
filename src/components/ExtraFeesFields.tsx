"use client";

import { useState } from "react";
import {
  ESCROW_FEE,
  TRAVEL_FEES,
  normalizeTravelFee,
  PRICING_CATALOG_ENABLED,
  type TravelFee,
} from "@/lib/pricing";

/**
 * Escrow + travel-fee form controls. Lifted out of PackagePicker so
 * they can be positioned with the other stage options on each form
 * (new stage, edit stage, new estimate).
 *
 * Emits two hidden form fields, same names as before — server-side
 * parsePricingFromForm reads them unchanged:
 *   - escrow: "on" | ""
 *   - travel_fee: "0" | "200" | "300"
 */
export default function ExtraFeesFields({
  defaultEscrow = false,
  defaultTravelFee = 0,
}: {
  defaultEscrow?: boolean;
  defaultTravelFee?: number;
}) {
  const [escrow, setEscrow] = useState<boolean>(defaultEscrow);
  const [travelFee, setTravelFee] = useState<TravelFee>(
    normalizeTravelFee(defaultTravelFee),
  );

  // Manual-amount-only mode: no escrow/travel UI. Emit the hidden fields
  // at their neutral defaults so the server's pricing parser is unaffected.
  if (!PRICING_CATALOG_ENABLED) {
    return (
      <>
        <input type="hidden" name="escrow" value="" />
        <input type="hidden" name="travel_fee" value="0" />
      </>
    );
  }

  return (
    <div className="space-y-3">
      <input type="hidden" name="escrow" value={escrow ? "on" : ""} />
      <input type="hidden" name="travel_fee" value={String(travelFee)} />

      {/* Escrow toggle */}
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={escrow}
          onChange={(e) => setEscrow(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand"
        />
        <span>
          Paying through escrow (+${ESCROW_FEE})
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            Adds a flat ${ESCROW_FEE} escrow fee as its own line item.
          </span>
        </span>
      </label>

      {/* Travel fee */}
      <div className="space-y-1.5">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Travel fee
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-sm">
          {TRAVEL_FEES.map((amt, i) => {
            const active = travelFee === amt;
            return (
              <button
                key={amt}
                type="button"
                onClick={() => setTravelFee(amt)}
                className={`px-3 py-1.5 transition ${
                  i > 0
                    ? "border-l border-slate-200 dark:border-slate-700"
                    : ""
                } ${
                  active
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
                aria-pressed={active}
              >
                {amt === 0 ? "None" : `+$${amt}`}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Added as a separate line item on the invoice and contract.
        </p>
      </div>
    </div>
  );
}
