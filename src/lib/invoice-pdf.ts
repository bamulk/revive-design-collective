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
  propertyAddress: string;
  stageDate: string | null;
  destageDate: string | null;
  /** Rental-period length in days (60 default, 90 for extended). */
  stageLengthDays?: 60 | 90;
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

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${input.invoiceNumber}`);
  pdf.setAuthor(company);

  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 56;
  const width = 612 - margin * 2;
  let y = 792 - margin;

  const black = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.35, 0.38, 0.45);
  const brand = rgb(0.486, 0.545, 0.463); // approx #7c8b76 (sage)

  const drawText = (
    text: string,
    opts: {
      size?: number;
      font?: typeof font;
      color?: ReturnType<typeof rgb>;
      x?: number;
    } = {}
  ) => {
    page.drawText(sanitizePdfText(text), {
      x: opts.x ?? margin,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? font,
      color: opts.color ?? black,
    });
  };

  // Header: company name + business address (left), big "INVOICE" +
  // number/dates (right). The address is drawn at fixed offsets from
  // the header top so it fills the left side of the rows the right
  // column already occupies — the shared y cursor keeps flowing down
  // the right column untouched.
  const COMPANY_ADDRESS_LINES = [
    "7819 Mount Diablo Ct",
    "Fair Oaks, CA 95628",
  ];
  drawText(company, { size: 20, font: bold });
  const headerTop = y;
  COMPANY_ADDRESS_LINES.forEach((line, i) => {
    page.drawText(line, {
      x: margin,
      y: headerTop - 22 - i * 14,
      size: 10,
      font,
      color: muted,
    });
  });
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

  // Bill To / Property
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
    drawText(input.clientAddress, { size: 10, color: muted });
    y -= 14;
  }

  y -= 8;
  drawText("Property", { size: 9, font: bold, color: muted });
  y -= 14;
  drawText(input.propertyAddress, { size: 11 });
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

  // Line items table
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + width, y },
    thickness: 0.5,
    color: rgb(0.7, 0.73, 0.78),
  });
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
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + width, y },
    thickness: 0.5,
    color: rgb(0.7, 0.73, 0.78),
  });
  y -= 16;

  for (const li of input.lineItems) {
    drawText(li.label, { size: 11 });
    page.drawText(fmtMoney(li.amount), {
      x: margin + width - 70,
      y,
      size: 11,
      font,
      color: black,
    });
    y -= 14;
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
    color: rgb(0.7, 0.73, 0.78),
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
    drawText(input.packageIncludesNote, {
      size: 9,
      color: muted,
    });
    y -= 16;
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

  // Terms — bullet list at the bottom of the page. Uses smaller text
  // so we can fit a longer list without spilling onto a second page.
  if (input.terms && input.terms.length > 0) {
    y -= 6;
    drawText("Terms", { size: 9, font: bold, color: muted });
    y -= 12;
    const termSize = 9;
    const lineHeight = 11;
    const bulletIndent = 10;
    for (const t of input.terms) {
      const wrapped = wrapToWidth(t, font, termSize, width - bulletIndent);
      // Bullet on the first wrapped line, indent on continuations.
      wrapped.forEach((line, i) => {
        // Don't run off the bottom; stop before the footer baseline.
        if (y < 72) return;
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

  // Footer
  page.drawText(sanitizePdfText(`Thank you for your business — ${company}`), {
    x: margin,
    y: 56,
    size: 9,
    font,
    color: muted,
  });

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
