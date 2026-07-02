// Rule-based expense categorization. Keep all the matching logic in
// one place so the import action and the "recategorize" backfill use
// the exact same rules.
//
// Rules (case-insensitive match on the BoA description):
//   - Zelle / Apple Cash / Cash App / Venmo            → Payroll
//   - ARCO / Rio Food & Liq                            → Gas
//   - everything else                                  → Inventory
//
// Add new vendors here as they show up.

export type ExpenseCategory = "Payroll" | "Gas" | "Inventory";

const RULES: { pattern: RegExp; category: ExpenseCategory }[] = [
  {
    pattern: /\b(zelle|apple\s*cash|cash\s*app|venmo)\b/i,
    category: "Payroll",
  },
  {
    pattern: /\b(arco|rio\s+food)\b/i,
    category: "Gas",
  },
];

export function categorizeExpense(description: string): ExpenseCategory {
  for (const r of RULES) {
    if (r.pattern.test(description)) return r.category;
  }
  return "Inventory";
}
