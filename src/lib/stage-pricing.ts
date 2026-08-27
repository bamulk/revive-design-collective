import {
  computePrice,
  parseLineItems,
  sumLineItems,
  ESCROW_FEE,
  type SelectedAddOn,
} from "./pricing";

export type StageLineItem = { label: string; amount: number; notes?: string };

export type StagePricing = {
  /** Itemized charges, in the order they should be printed. */
  lineItems: StageLineItem[];
  /** Catalog discount (always 0 for custom-priced stages). */
  discount: number;
  /** What the client owes — matches stages.amount for custom prices. */
  total: number;
  isCustomPrice: boolean;
  hasPackage: boolean;
};

type StageLike = {
  amount?: number | null;
  escrow?: boolean | null;
  travel_fee?: number | null;
  line_items?: unknown;
  package_key?: string | null;
  add_ons?: unknown;
  discount?: number | null;
};

/**
 * Single source of truth for a stage's itemized pricing. The contract
 * PDF, the invoice PDF, and the agent's signer-choice email all render
 * from this, so the three can never disagree about what a stage costs.
 *
 * Custom-priced stages (no package, just a typed amount) store a total
 * that already includes escrow + travel + custom line items, so those
 * are backed out to recover the base staging charge.
 */
export function buildStagePricing(
  stage: StageLike,
  opts: { packageNote?: string } = {},
): StagePricing {
  const breakdown = computePrice(
    (stage.package_key ?? null) as string | null,
    (stage.add_ons ?? []) as SelectedAddOn[],
    Number(stage.discount ?? 0),
  );

  const stageAmount = Number(stage.amount ?? 0);
  const escrowOn = !!stage.escrow;
  const travelFee = Number(stage.travel_fee ?? 0) || 0;
  const customLineItems = parseLineItems(stage.line_items);
  const lineItemsTotal = sumLineItems(customLineItems);
  const customSubtotal = Math.max(
    0,
    stageAmount - (escrowOn ? ESCROW_FEE : 0) - travelFee - lineItemsTotal,
  );
  const isCustomPrice = !stage.package_key && customSubtotal > 0;
  const note = opts.packageNote;

  const lineItems: StageLineItem[] = [
    ...(isCustomPrice
      ? [
          {
            label: "Home staging",
            amount: customSubtotal,
            ...(note ? { notes: note } : {}),
          },
        ]
      : [
          ...(breakdown.package
            ? [
                {
                  label: breakdown.package.label,
                  amount: breakdown.package.price,
                  ...(note ? { notes: note } : {}),
                },
              ]
            : []),
          ...breakdown.addOns.map((a) => ({
            label: `${a.addOn.label} × ${a.qty}`,
            amount: a.subtotal,
          })),
        ]),
    ...customLineItems.map((li) => ({
      label: li.description,
      amount: li.price,
    })),
    ...(escrowOn ? [{ label: "Escrow payment fee", amount: ESCROW_FEE }] : []),
    ...(travelFee > 0 ? [{ label: "Travel fee", amount: travelFee }] : []),
  ];

  return {
    lineItems,
    discount: isCustomPrice ? 0 : breakdown.discount,
    // For package pricing, breakdown.total excludes escrow/travel/custom
    // items, so add them back.
    total: isCustomPrice
      ? stageAmount
      : breakdown.total + (escrowOn ? ESCROW_FEE : 0) + travelFee + lineItemsTotal,
    isCustomPrice,
    hasPackage: !!breakdown.package,
  };
}
