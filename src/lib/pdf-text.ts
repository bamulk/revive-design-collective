/**
 * pdf-lib's standard fonts encode with WinAnsi (~ Latin-1), which can't
 * represent characters like the Unicode minus sign (U+2212), smart
 * quotes, en/em dashes, or the ellipsis. Drawing any of those throws
 * "WinAnsi cannot encode ..." and aborts PDF generation.
 *
 * This maps the common offenders to ASCII-safe equivalents and drops
 * anything else outside the Latin-1 range, so contract/invoice PDFs
 * never crash on a stray pasted character (e.g. a discount line or a
 * value typed into the contract template).
 *
 * Uses \u escapes (not literal glyphs) so this file stays plain ASCII
 * and its diffs remain reviewable.
 */
export function sanitizePdfText(input: string): string {
  if (!input) return input;
  return input
    .replace(/[\u2010-\u2015\u2212]/g, "-") // hyphens, dashes, minus sign
    .replace(/[\u2018-\u201B]/g, "'") // single / curly quotes
    .replace(/[\u201C-\u201F]/g, '"') // double / curly quotes
    .replace(/\u2026/g, "...") // ellipsis
    .replace(/[\u00A0\u2007\u2009\u202F]/g, " ") // non-breaking / thin spaces
    .replace(/\u2022/g, "-") // bullet
    .replace(/\u2122/g, "(TM)") // trademark
    .replace(/[^\u0020-\u00FF]/g, ""); // strip anything else non-Latin-1
}
