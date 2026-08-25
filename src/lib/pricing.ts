// Staging pricing catalog — mirrors https://revivedesigncollective.com/pricing/
// Single source of truth for package + add-on prices so the UI, server action,
// contract PDF, and invoice all compute the same total.

export type Package = {
  key: string;
  label: string;
  sqftMin: number | null;
  sqftMax: number;
  livingSpaces: 1 | 2;
  price: number;
  /** Rental period in days. */
  durationDays: number;
};

export type AddOn = {
  key: string;
  label: string;
  price: number;
};

/**
 * Temporary switch. When false, the app hides the package catalog,
 * add-ons, escrow, travel fee, and custom-line-item UI and prices every
 * job with a single manual "Amount" field (stored as a custom price).
 * Flip to true to restore the full pricing catalog once Revive's own
 * package pricing is set. The catalog data below is kept intact so
 * turning it back on is a one-line change.
 */
export const PRICING_CATALOG_ENABLED = false;

export const PACKAGES: Package[] = [
  { key: "lt1500_1ls", label: "Up to 1,500 sq ft — 1 living/dining space", sqftMin: null, sqftMax: 1500, livingSpaces: 1, price: 1800, durationDays: 60 },
  { key: "lt1500_2ls", label: "Up to 1,500 sq ft — 2 living/dining spaces", sqftMin: null, sqftMax: 1500, livingSpaces: 2, price: 2100, durationDays: 60 },
  { key: "1600_2500_1ls", label: "1,600–2,500 sq ft — 1 living/dining space", sqftMin: 1600, sqftMax: 2500, livingSpaces: 1, price: 2200, durationDays: 60 },
  { key: "1600_2500_2ls", label: "1,600–2,500 sq ft — 2 living/dining spaces", sqftMin: 1600, sqftMax: 2500, livingSpaces: 2, price: 2500, durationDays: 60 },
  { key: "2600_3000_1ls", label: "2,600–3,000 sq ft — 1 living/dining space", sqftMin: 2600, sqftMax: 3000, livingSpaces: 1, price: 2600, durationDays: 60 },
  { key: "2600_3000_2ls", label: "2,600–3,000 sq ft — 2 living/dining spaces", sqftMin: 2600, sqftMax: 3000, livingSpaces: 2, price: 2900, durationDays: 60 },
  { key: "3100_4500_1ls", label: "3,100–4,500 sq ft — 1 living/dining space", sqftMin: 3100, sqftMax: 4500, livingSpaces: 1, price: 3000, durationDays: 60 },
  { key: "3100_4500_2ls", label: "3,100–4,500 sq ft — 2 living/dining spaces", sqftMin: 3100, sqftMax: 4500, livingSpaces: 2, price: 3300, durationDays: 60 },
];

export const ADD_ONS: AddOn[] = [
  { key: "extra_living", label: "Extra living space", price: 400 },
  { key: "extra_bedroom", label: "Extra bedroom, office, or dining room", price: 300 },
];

/** Fixed surcharge added to the total when the client pays through escrow. */
export const ESCROW_FEE = 350;

/**
 * Two preset travel-fee tiers. Selected per-stage on the form; 0
 * means no travel fee. Listed here so the picker, the server, and
 * the PDFs all agree on what's valid.
 */
export const TRAVEL_FEES = [0, 200, 300] as const;
export type TravelFee = (typeof TRAVEL_FEES)[number];

export function normalizeTravelFee(n: unknown): TravelFee {
  const v = Number(n);
  return (TRAVEL_FEES as readonly number[]).includes(v) ? (v as TravelFee) : 0;
}

/**
 * What's included in every catalog package — surfaced on the public
 * estimate, the contract PDF, and the invoice PDF so the client always
 * sees the scope of work. Doesn't include the rental period (that's
 * dynamic per stage_length_days).
 */
export const PACKAGE_INCLUDES =
  "Staging package includes staging for kitchen, bathrooms, primary bedroom, and outdoor living.";

export type SelectedAddOn = { key: string; qty: number };

/**
 * A free-form custom pricing line item (description + price). Stored on
 * stages.line_items (jsonb) and rendered on the estimate, contract, and
 * invoice. Independent of the package catalog — these are ad-hoc charges
 * the admin types in (e.g. "Extra week of storage", "Piano move").
 */
export type LineItem = { description: string; price: number };

const MAX_LINE_ITEMS = 25;
const MAX_DESCRIPTION_LEN = 200;

/**
 * Sanitize custom line items from either a jsonb value (already an array)
 * or the JSON string emitted by the form's hidden field. Trims and caps
 * descriptions, coerces prices to non-negative numbers rounded to cents,
 * and drops blank or invalid rows. Always returns a safe array.
 */
export function parseLineItems(raw: unknown): LineItem[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((it) => {
      const description = String((it as any)?.description ?? "")
        .trim()
        .slice(0, MAX_DESCRIPTION_LEN);
      const price =
        Math.round((Number((it as any)?.price) + Number.EPSILON) * 100) / 100;
      return { description, price };
    })
    .filter(
      (it) =>
        it.description.length > 0 &&
        Number.isFinite(it.price) &&
        it.price >= 0,
    )
    .slice(0, MAX_LINE_ITEMS);
}

/** Sum of all line-item prices (0 for an empty/invalid list). */
export function sumLineItems(items: LineItem[]): number {
  return items.reduce(
    (s, it) => s + (Number.isFinite(it.price) ? it.price : 0),
    0,
  );
}

export type PriceBreakdown = {
  package: Package | null;
  addOns: Array<{ addOn: AddOn; qty: number; subtotal: number }>;
  subtotal: number;
  discount: number;
  total: number;
};

export function findPackage(key: string | null | undefined): Package | null {
  if (!key) return null;
  return PACKAGES.find((p) => p.key === key) ?? null;
}

export function findAddOn(key: string): AddOn | null {
  return ADD_ONS.find((a) => a.key === key) ?? null;
}

export function computePrice(
  packageKey: string | null | undefined,
  selectedAddOns: SelectedAddOn[],
  discount = 0
): PriceBreakdown {
  const pkg = findPackage(packageKey);
  const addOns = selectedAddOns
    .map((sa) => {
      const a = findAddOn(sa.key);
      if (!a || sa.qty <= 0) return null;
      return { addOn: a, qty: sa.qty, subtotal: a.price * sa.qty };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const subtotal =
    (pkg?.price ?? 0) + addOns.reduce((s, x) => s + x.subtotal, 0);
  const safeDiscount = Math.max(0, Math.min(discount || 0, subtotal));
  const total = Math.max(0, subtotal - safeDiscount);

  return {
    package: pkg,
    addOns,
    subtotal,
    discount: safeDiscount,
    total,
  };
}
