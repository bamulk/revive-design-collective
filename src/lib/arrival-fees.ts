/**
 * Extra charges the crew can report on arrival. Amounts live here (one
 * place) and flow into the contract's "Additional Fees" block, the
 * stage-page report form, and the fee invoice line items.
 */
export const ARRIVAL_FEE_REASONS = {
  no_lockbox_key: { label: "No lockbox key", amount: 100 },
  house_inaccessible: { label: "House inaccessible", amount: 100 },
  house_not_ready: { label: "House not ready for staging", amount: 100 },
} as const;

export type ArrivalFeeReason = keyof typeof ARRIVAL_FEE_REASONS;

export const ARRIVAL_FEE_KEYS = Object.keys(
  ARRIVAL_FEE_REASONS,
) as ArrivalFeeReason[];

export function isArrivalFeeReason(v: unknown): v is ArrivalFeeReason {
  return typeof v === "string" && v in ARRIVAL_FEE_REASONS;
}

export function arrivalFeeTotal(reasons: ArrivalFeeReason[]): number {
  return reasons.reduce((s, r) => s + ARRIVAL_FEE_REASONS[r].amount, 0);
}

export function arrivalFeeLabels(reasons: readonly string[]): string[] {
  return reasons
    .filter(isArrivalFeeReason)
    .map((r) => ARRIVAL_FEE_REASONS[r].label);
}

/** Clause printed in the contract's initialed Additional Fees block. */
export const ARRIVAL_FEE_CLAUSE =
  `If the staging team arrives on the scheduled stage or destage day and ` +
  `the lockbox key is missing ($${ARRIVAL_FEE_REASONS.no_lockbox_key.amount}), ` +
  `the home is inaccessible ($${ARRIVAL_FEE_REASONS.house_inaccessible.amount}), ` +
  `or the home is not ready for staging ($${ARRIVAL_FEE_REASONS.house_not_ready.amount}), ` +
  `the indicated fee applies per occurrence and will be invoiced separately. ` +
  `Client initials below to acknowledge.`;
