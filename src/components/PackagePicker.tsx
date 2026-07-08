"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import {
  PACKAGES,
  ADD_ONS,
  computePrice,
  type SelectedAddOn,
} from "@/lib/pricing";

type Props = {
  defaultPackageKey?: string | null;
  defaultAddOns?: SelectedAddOn[];
  defaultDiscount?: number;
  /**
   * Pre-fill the custom-price field. When non-null and >0 AND no
   * defaultPackageKey is provided, the picker opens in Custom-price
   * mode (handy for editing a stage that was saved as a custom price).
   */
  defaultCustomAmount?: number | null;
  /**
   * Read-only display: hides the package grid, add-on steppers, and
   * discount input. Only renders the breakdown bar (and no hidden form
   * inputs, since there's no form to submit to in read-only mode).
   */
  compact?: boolean;
  /**
   * Rendered between the pricing inputs and the subtotal box, in BOTH
   * modes — the slot the forms use for <CustomLineItemsFields />. Kept
   * outside the mode branches so it stays mounted when the admin flips
   * Package <-> Custom price (unmounting would wipe typed rows).
   * Ignored in compact mode.
   */
  beforeSummary?: React.ReactNode;
};

/**
 * Package + add-ons + discount picker. Emits three hidden form fields so the
 * containing <form action={serverAction}> just works:
 *   - package_key: string
 *   - add_ons: JSON-encoded SelectedAddOn[]
 *   - discount: number
 * The amount is recomputed server-side from the catalog, so client tampering
 * with a hidden "total" field wouldn't change the saved price.
 */
export default function PackagePicker({
  defaultPackageKey = null,
  defaultAddOns = [],
  defaultDiscount = 0,
  defaultCustomAmount = null,
  compact = false,
  beforeSummary = null,
}: Props) {
  const [packageKey, setPackageKey] = useState<string | null>(defaultPackageKey);
  const [addOnQty, setAddOnQty] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const a of ADD_ONS) map[a.key] = 0;
    for (const d of defaultAddOns) map[d.key] = d.qty;
    return map;
  });
  const [discount, setDiscount] = useState<number>(defaultDiscount);
  // Custom-price mode short-circuits the catalog and submits a single
  // amount the admin types in. Default it on when the stage was saved
  // without a package_key but still has an amount.
  const [customMode, setCustomMode] = useState<boolean>(
    !defaultPackageKey && (defaultCustomAmount ?? 0) > 0,
  );
  const [customAmount, setCustomAmount] = useState<number>(
    defaultCustomAmount ?? 0,
  );

  const selected: SelectedAddOn[] = useMemo(
    () =>
      Object.entries(addOnQty)
        .filter(([, qty]) => qty > 0)
        .map(([key, qty]) => ({ key, qty })),
    [addOnQty]
  );

  const breakdown = useMemo(
    () => computePrice(packageKey, selected, discount),
    [packageKey, selected, discount]
  );

  if (compact) {
    const subtotal = customMode ? customAmount : breakdown.total;
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 space-y-1 text-sm">
        {customMode ? (
          <Row label="Custom price" value={customAmount} />
        ) : (
          <>
            {breakdown.package ? (
              <Row
                label={breakdown.package.label}
                value={breakdown.package.price}
              />
            ) : (
              <div className="text-slate-500 dark:text-slate-400 italic">
                No package selected
              </div>
            )}
            {breakdown.addOns.map((a) => (
              <Row
                key={a.addOn.key}
                label={`${a.addOn.label} × ${a.qty}`}
                value={a.subtotal}
              />
            ))}
            {breakdown.discount > 0 && (
              <Row label="Discount" value={-breakdown.discount} />
            )}
          </>
        )}
        <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
        <Row label="Package subtotal" value={subtotal} bold />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Hidden form fields — server reads custom_amount first; when
          set, it ignores package_key/add_ons/discount. */}
      <input
        type="hidden"
        name="package_key"
        value={customMode ? "" : packageKey ?? ""}
      />
      <input
        type="hidden"
        name="add_ons"
        value={customMode ? "[]" : JSON.stringify(selected)}
      />
      <input
        type="hidden"
        name="discount"
        value={customMode ? "0" : String(discount || 0)}
      />
      <input
        type="hidden"
        name="custom_amount"
        value={customMode ? String(customAmount || 0) : ""}
      />

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-sm">
        <button
          type="button"
          onClick={() => setCustomMode(false)}
          className={`px-3 py-1.5 transition ${
            !customMode
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
              : "bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
          aria-pressed={!customMode}
        >
          Package
        </button>
        <button
          type="button"
          onClick={() => setCustomMode(true)}
          className={`px-3 py-1.5 transition border-l border-slate-200 dark:border-slate-700 ${
            customMode
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
              : "bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
          aria-pressed={customMode}
        >
          Custom price
        </button>
      </div>


      {customMode ? (
        <div>
          <label className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">
            Custom stage price (USD) *
          </label>
          <div className="relative max-w-[220px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400">
              $
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={customAmount || ""}
              onChange={(e) => setCustomAmount(Number(e.target.value) || 0)}
              placeholder="0.00"
              className="w-full border rounded-lg pl-7 pr-3 py-2.5 text-base"
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Use when the job doesn't fit a standard package — the invoice
            will show a single &ldquo;Home staging&rdquo; line item for this
            amount.
          </p>
        </div>
      ) : (
        <PackageMode
          packageKey={packageKey}
          setPackageKey={setPackageKey}
          addOnQty={addOnQty}
          setAddOnQty={setAddOnQty}
          discount={discount}
          setDiscount={setDiscount}
        />
      )}

      {/* Slot for custom line items — after the pricing inputs, above
          the subtotal box, mounted continuously across mode flips. */}
      {beforeSummary}

      {/* Subtotal box — hoisted out of the mode branches so the slot
          above renders between the inputs and this box in both modes. */}
      {customMode ? (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 text-sm space-y-1">
          <Row label="Custom price" value={customAmount} bold />
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 space-y-1 text-sm">
          {breakdown.package ? (
            <Row
              label={breakdown.package.label}
              value={breakdown.package.price}
            />
          ) : (
            <div className="text-slate-500 dark:text-slate-400 italic">
              Select a package…
            </div>
          )}
          {breakdown.addOns.map((a) => (
            <Row
              key={a.addOn.key}
              label={`${a.addOn.label} × ${a.qty}`}
              value={a.subtotal}
            />
          ))}
          {breakdown.discount > 0 && (
            <Row label="Discount" value={-breakdown.discount} />
          )}
          <div className="border-t border-slate-200 dark:border-slate-700 my-1" />
          <Row label="Package subtotal" value={breakdown.total} bold />
        </div>
      )}
    </div>
  );
}

function PackageMode({
  packageKey,
  setPackageKey,
  addOnQty,
  setAddOnQty,
  discount,
  setDiscount,
}: {
  packageKey: string | null;
  setPackageKey: (k: string | null) => void;
  addOnQty: Record<string, number>;
  setAddOnQty: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  discount: number;
  setDiscount: (n: number) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Packages */}
      <div>
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">Package *</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PACKAGES.map((p) => {
            const active = packageKey === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPackageKey(p.key)}
                className={`text-left rounded-lg border p-3 transition ${
                  active
                    ? "border-brand ring-2 ring-amber-100 bg-amber-50/40"
                    : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-snug">
                    {p.label}
                  </div>
                  {active && (
                    <span className="text-brand flex-none">
                      <Check size={16} />
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm tabular-nums text-slate-700 dark:text-slate-300">
                  ${p.price.toLocaleString()}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Add-ons */}
      <div>
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">Add-ons</div>
        <div className="space-y-2">
          {ADD_ONS.map((a) => {
            const qty = addOnQty[a.key] ?? 0;
            return (
              <div
                key={a.key}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {a.label}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                    ${a.price.toLocaleString()} each
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-none">
                  <button
                    type="button"
                    aria-label={`Decrease ${a.label}`}
                    onClick={() =>
                      setAddOnQty((m) => ({
                        ...m,
                        [a.key]: Math.max(0, (m[a.key] ?? 0) - 1),
                      }))
                    }
                    className="w-9 h-9 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm tabular-nums">
                    {qty}
                  </span>
                  <button
                    type="button"
                    aria-label={`Increase ${a.label}`}
                    onClick={() =>
                      setAddOnQty((m) => ({
                        ...m,
                        [a.key]: (m[a.key] ?? 0) + 1,
                      }))
                    }
                    className="w-9 h-9 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Discount */}
      <div>
        <label className="block text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">
          Discount (USD)
        </label>
        <div className="relative max-w-[160px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 dark:text-slate-400">
            $
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={discount || ""}
            onChange={(e) => setDiscount(Number(e.target.value) || 0)}
            placeholder="0"
            className="w-full border rounded-lg pl-7 pr-3 py-2.5 text-base"
          />
        </div>
      </div>

    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: number;
  bold?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${
        bold ? "font-semibold text-slate-900 dark:text-slate-100" : "text-slate-700 dark:text-slate-300"
      }`}
    >
      <span className="truncate pr-2">{label}</span>
      <span className="tabular-nums">
        {value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}
      </span>
    </div>
  );
}
