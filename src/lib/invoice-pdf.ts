// Generates an invoice PDF for a stage. Same single-page US Letter
// format and font choices as contract-pdf.ts so the documents feel
// like a matching pair.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { sanitizePdfText } from "./pdf-text";

export type InvoiceLineItem = {
  label: string;
  amount: number;
  /** Optional muted sub-line printed under the label (e.g. "Includes
   * kitchen, bathrooms, primary bedroom, and outdoor living"). */
  notes?: string;
  /** When both are set (custom invoices), a muted "qty × unit" line is
   *  printed under the label so the math is visible. */
  qty?: number;
  unitPrice?: number;
};

export type InvoiceInput = {
  companyName?: string;
  invoiceNumber: string;
  invoiceDate: string;          // ISO yyyy-mm-dd
  dueDate?: string | null;      // ISO yyyy-mm-dd
  clientName: string;
  /** Per-stage billing entity (e.g. an LLC) — when set, printed as the
   *  Bill To name with the client shown as "c/o" beneath. */
  billTo?: string | null;
  clientEmail?: string | null;
  clientAddress?: string | null;
  /**
   * Stage invoices print a Property block (address + stage/destage
   * dates + rental period). Custom invoices (cleaning, furniture, split
   * billing) print a "Re:" block instead: `title` and the optional
   * `reference` line, no dates.
   */
  layout?: "stage" | "custom";
  propertyAddress?: string | null;
  stageDate?: string | null;
  destageDate?: string | null;
  /** Rental-period length in days (60 default, 90 for extended). */
  stageLengthDays?: 60 | 90;
  /** Custom layout: what the invoice is for, e.g. "Cleaning fee". */
  title?: string | null;
  /** Custom layout: optional second line under the title. */
  reference?: string | null;
  /** Free-form note printed under the totals (custom layout). */
  notes?: string | null;
  lineItems: InvoiceLineItem[];
  discount?: number;
  total: number;
  /** Free-form payment instructions block (e.g. "Make checks payable to..."). */
  paymentInstructions?: string | null;
  /**
   * Text rendered as the "Payment terms" line near the totals. Pass
   * a one-liner that captures when payment is due (e.g.
   * "Payment due on completion of stage").
   */
  paymentTerms?: string | null;
  /** "What's included in the package" copy. Rendered as a sub-line
   *  under the line-item table when present. */
  packageIncludesNote?: string | null;
  /**
   * Bullet-style list of terms shown at the very bottom of the
   * invoice. Pass each term as a separate string — the renderer
   * wraps long lines automatically.
   */
  terms?: string[];
};

function fmtDate(iso: string | null | undefined): string {
  // Missing dates print as "TBD" on the invoice — clearer than a
  // blank or em dash for the homeowner.
  if (!iso) return "TBD";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Wraps a string to a target pixel width by measuring with the supplied
 * font. Used for the Terms block so long lines don't run off the page.
 */
function wrapToWidth(
  text: string,
  font: import("pdf-lib").PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = sanitizePdfText(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    const wWidth = font.widthOfTextAtSize(candidate, size);
    if (wWidth > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

export async function generateInvoicePdf(
  input: InvoiceInput
): Promise<Uint8Array> {
  const company = input.companyName || "Revive Design Collective";
  const layout = input.layout ?? "stage";

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${input.invoiceNumber}`);
  pdf.setAuthor(company);

  let page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 56;
  const width = 612 - margin * 2;
  // Keep clear of the footer line drawn at y=56 on every page.
  const bottom = 80;
  let y = 792 - margin;

  const black = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.35, 0.38, 0.45);
  const brand = rgb(0.486, 0.545, 0.463); // approx #7c8b76 (sage)
  const rule = rgb(0.7, 0.73, 0.78);

  const drawFooter = (pg: typeof page) => {
    pg.drawText(sanitizePdfText(`Thank you for your business — ${company}`), {
      x: margin,
      y: 56,
      size: 9,
      font,
      color: muted,
    });
  };

  // Start a new page when the next block won't fit. Long term lists
  // used to be silently dropped past the footer; now they continue.
  const breakIfNeeded = (needed: number) => {
    if (y - needed < bottom) {
      drawFooter(page);
      page = pdf.addPage([612, 792]);
      y = 792 - margin;
    }
  };

  const drawText = (
    text: string,
    opts: {
      size?: number;
      font?: typeof font;
      color?: ReturnType<typeof rgb>;
      x?: number;
    } = {}
  ) => {
    breakIfNeeded((opts.size ?? 10) + 4);
    page.drawText(sanitizePdfText(text), {
      x: opts.x ?? margin,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? font,
      color: opts.color ?? black,
    });
  };

  const drawRule = () => {
    page.drawLine({
      start: { x: margin, y },
      end: { x: margin + width, y },
      thickness: 0.5,
      color: rule,
    });
  };

  // Header: company name (left), big "INVOICE" + number/dates (right).
  drawText(company, { size: 20, font: bold });
  page.drawText("INVOICE", {
    x: margin + width - 110,
    y,
    size: 22,
    font: bold,
    color: brand,
  });
  y -= 22;
  page.drawText(`# ${input.invoiceNumber}`, {
    x: margin + width - 110,
    y,
    size: 11,
    font,
    color: muted,
  });
  y -= 18;
  page.drawText(`Issued ${fmtDate(input.invoiceDate)}`, {
    x: margin + width - 110,
    y,
    size: 10,
    font,
    color: muted,
  });
  if (input.dueDate) {
    y -= 14;
    page.drawText(`Due ${fmtDate(input.dueDate)}`, {
      x: margin + width - 110,
      y,
      size: 10,
      font,
      color: muted,
    });
  }
  y -= 24;

  // Bill To
  drawText("Bill To", { size: 9, font: bold, color: muted });
  y -= 14;
  if (input.billTo) {
    drawText(input.billTo, { size: 11 });
    y -= 14;
    drawText(`c/o ${input.clientName}`, { size: 10, color: muted });
    y -= 14;
  } else {
    drawText(input.clientName, { size: 11 });
    y -= 14;
  }
  if (input.clientEmail) {
    drawText(input.clientEmail, { size: 10, color: muted });
    y -= 14;
  }
  if (input.clientAddress) {
    // Addresses may carry newlines (street / city line).
    for (const line of input.clientAddress.split(/\r?\n/)) {
      if (!line.trim()) continue;
      drawText(line.trim(), { size: 10, color: muted });
      y -= 14;
    }
  }

  y -= 8;
  if (layout === "stage") {
    // Property block with the rental window.
    drawText("Property", { size: 9, font: bold, color: muted });
    y -= 14;
    drawText(input.propertyAddress ?? "", { size: 11 });
    y -= 14;
    drawText(
      // ASCII arrow only — pdf-lib's StandardFonts.Helvetica uses WinAnsi
      // encoding, which doesn't include "→" (U+2192).
      `Stage ${fmtDate(input.stageDate)} -> Destage ${fmtDate(input.destageDate)}`,
      { size: 10, color: muted }
    );
    y -= 14;
    const stageLen = input.stageLengthDays === 90 ? 90 : 60;
    drawText(`Rental period: ${stageLen} days`, { size: 10, color: muted });
    y -= 18;
  } else {
    // "Re:" block — what this invoice is for.
    const title = (input.title ?? "").trim();
    const ref = (input.reference ?? "").trim();
    if (title || ref) {
      drawText("Re", { size: 9, font: bold, color: muted });
      y -= 14;
      if (title) {
        for (const line of wrapToWidth(title, font, 11, width)) {
          drawText(line, { size: 11 });
          y -= 14;
        }
      }
      if (ref) {
        for (const line of wrapToWidth(ref, font, 10, width)) {
          drawText(line, { size: 10, color: muted });
          y -= 14;
        }
      }
      y -= 4;
    }
    y -= 6;
  }

  // Line items table
  breakIfNeeded(60);
  drawRule();
  y -= 14;
  drawText("Description", { size: 9, font: bold, color: muted });
  page.drawText("Amount", {
    x: margin + width - 70,
    y,
    size: 9,
    font: bold,
    color: muted,
  });
  y -= 8;
  drawRule();
  y -= 16;

  for (const li of input.lineItems) {
    breakIfNeeded(14 + (li.notes ? 22 : 0) + 4);
    const labelLines = wrapToWidth(li.label, font, 11, width - 90);
    labelLines.forEach((line, i) => {
      drawText(line, { size: 11 });
      if (i === 0) {
        page.drawText(fmtMoney(li.amount), {
          x: margin + width - 70,
          y,
          size: 11,
          font,
          color: black,
        });
      }
      y -= 14;
    });
    // Custom invoices: show the quantity math when it isn't a plain 1×.
    if (
      typeof li.qty === "number" &&
      typeof li.unitPrice === "number" &&
      (li.qty !== 1 || li.unitPrice !== li.amount)
    ) {
      const qtyText = Number.isInteger(li.qty) ? String(li.qty) : li.qty.toFixed(2);
      drawText(`${qtyText} x ${fmtMoney(li.unitPrice)}`, { size: 9, color: muted });
      y -= 11;
    }
    // Optional muted sub-line — e.g. what the package includes.
    if (li.notes) {
      // Keep room for the amount column by trimming to label width.
      const noteLines = wrapToWidth(li.notes, font, 9, width - 80);
      for (const nl of noteLines) {
        drawText(nl, { size: 9, color: muted });
        y -= 11;
      }
    }
    y -= 4;
  }

  breakIfNeeded(60);
  if (input.discount && input.discount > 0) {
    drawText("Discount", { size: 11, color: muted });
    page.drawText(`-${fmtMoney(input.discount)}`, {
      x: margin + width - 70,
      y,
      size: 11,
      font,
      color: muted,
    });
    y -= 18;
  }

  page.drawLine({
    start: { x: margin, y: y + 4 },
    end: { x: margin + width, y: y + 4 },
    thickness: 0.5,
    color: rule,
  });
  y -= 14;
  drawText("Total", { size: 13, font: bold });
  page.drawText(fmtMoney(input.total), {
    x: margin + width - 70,
    y,
    size: 13,
    font: bold,
    color: black,
  });
  y -= 22;

  // Package-includes scope note. Skip for custom-priced invoices
  // (caller passes null). Wraps naturally — keep it short.
  if (input.packageIncludesNote) {
    for (const line of wrapToWidth(input.packageIncludesNote, font, 9, width)) {
      drawText(line, { size: 9, color: muted });
      y -= 11;
    }
    y -= 5;
  }

  y -= 14;

  // Payment terms — one-line summary of when payment is due. Sits
  // directly under the totals so it's the first thing the client sees
  // after the amount.
  if (input.paymentTerms) {
    drawText("Payment terms", { size: 9, font: bold, color: muted });
    y -= 14;
    const ptLines = wrapToWidth(input.paymentTerms, font, 11, width);
    for (const line of ptLines) {
      drawText(line, { size: 11 });
      y -= 14;
    }
    y -= 6;
  }

  // Free-form note (custom invoices).
  if (input.notes && input.notes.trim()) {
    drawText("Notes", { size: 9, font: bold, color: muted });
    y -= 14;
    for (const para of input.notes.split(/\r?\n/)) {
      if (!para.trim()) {
        y -= 6;
        continue;
      }
      for (const line of wrapToWidth(para, font, 10, width)) {
        drawText(line, { size: 10 });
        y -= 13;
      }
    }
    y -= 6;
  }

  // Payment instructions
  if (input.paymentInstructions) {
    drawText("Payment", { size: 9, font: bold, color: muted });
    y -= 14;
    const lines = input.paymentInstructions.split("\n");
    for (const line of lines) {
      drawText(line, { size: 11 });
      y -= 14;
    }
    y -= 8;
  }

  // Terms — bullet list at the bottom. Small text, and it continues on
  // a second page rather than being cut off.
  if (input.terms && input.terms.length > 0) {
    y -= 6;
    breakIfNeeded(40);
    drawText("Terms", { size: 9, font: bold, color: muted });
    y -= 12;
    const termSize = 9;
    const lineHeight = 11;
    const bulletIndent = 10;
    for (const t of input.terms) {
      const wrapped = wrapToWidth(t, font, termSize, width - bulletIndent);
      // Keep a bullet with at least its first two lines.
      breakIfNeeded(lineHeight * Math.min(wrapped.length, 2));
      wrapped.forEach((line, i) => {
        breakIfNeeded(lineHeight);
        if (i === 0) {
          page.drawText("-", {
            x: margin,
            y,
            size: termSize,
            font,
            color: muted,
          });
        }
        page.drawText(line, {
          x: margin + bulletIndent,
          y,
          size: termSize,
          font,
          color: black,
        });
        y -= lineHeight;
      });
    }
  }

  drawFooter(page);

  return await pdf.save();
}

/**
 * Short, readable invoice number derived from a stage ID and date so the
 * client sees something nicer than a UUID. Not guaranteed globally
 * unique on its own — pair with the stage_id in the DB if you need that.
 */
export function invoiceNumberFor(stageId: string, invoiceDate: string): string {
  const short = stageId.replace(/-/g, "").slice(0, 6).toUpperCase();
  const datePart = invoiceDate.replace(/-/g, "").slice(2, 8); // YYMMDD
  return `INV-${datePart}-${short}`;
}
