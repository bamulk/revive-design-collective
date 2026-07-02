// Dynamic PDF generator for the Home Staging Services Agreement.
//
// Produces a single-page contract with the stage's details filled in and a
// `{{client_signature}}` placement marker SignatureAPI overlays a signature
// field on.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { sanitizePdfText } from "./pdf-text";

export type ContractLineItem = {
  label: string;
  amount: number;
};

export type ContractInput = {
  companyName?: string;
  clientName: string;
  clientAddress?: string | null;
  propertyAddress: string;
  amount: number;
  stageDate: string | null;
  destageDate: string | null;
  /** Rental-period length in days (60 default, 90 for extended). */
  stageLengthDays?: 60 | 90;
  /** Optional secondary signer (homeowner / co-payer). When set, the
   *  contract renders a second signature line that SignatureAPI fills
   *  via the SECONDARY_SIGNATURE_FIELD position. */
  secondaryRecipientName?: string | null;
  stageId: string;
  /** Itemized breakdown shown above the total. */
  lineItems?: ContractLineItem[];
  discount?: number;
  /** Optional intro paragraph above Parties, from the editable template. */
  intro?: string | null;
  /** Numbered terms section, from the editable template. */
  terms?: { title: string; body: string }[];
  /** "What's included in the package" copy. Rendered between the total
   *  line and the Terms section. Skip for custom-priced stages. */
  packageIncludesNote?: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "TBD";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Substitute template placeholders in a term body with this stage's
 * actual values. Supported variables:
 *
 *   {{amount}}             — original invoice total ($X,XXX.XX)
 *   {{extension_amount}}   — 50% of amount (the renewal fee)
 *   {{stage_date}}         — long-form stage date
 *   {{destage_date}}       — long-form destage date
 *   {{client_name}}        — client's name
 *   {{property_address}}   — property
 *
 * Lets the editable template say "Extensions are {{extension_amount}}"
 * instead of "50% of original" so the rendered contract shows the real
 * dollar figure.
 */
function renderTermBody(body: string, input: ContractInput): string {
  const baseAmount = Number(input.amount ?? 0);
  const extensionAmount = Math.round(baseAmount * 50) / 100;
  const map: Record<string, string> = {
    "{{amount}}": fmtMoney(baseAmount),
    "{{extension_amount}}": fmtMoney(extensionAmount),
    "{{stage_date}}": fmtDate(input.stageDate ?? null),
    "{{destage_date}}": fmtDate(input.destageDate ?? null),
    "{{client_name}}": input.clientName || "",
    "{{property_address}}": input.propertyAddress || "",
  };
  return body.replace(
    /\{\{(amount|extension_amount|stage_date|destage_date|client_name|property_address)\}\}/g,
    (m) => map[m] ?? m,
  );
}

export async function generateContractPdf(
  input: ContractInput
): Promise<Uint8Array> {
  const company = input.companyName || "Staging Co.";
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Staging Agreement — ${input.propertyAddress}`);
  pdf.setAuthor(company);

  const page = pdf.addPage([612, 792]); // US Letter
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 56;
  const width = 612 - margin * 2;
  let y = 792 - margin;

  const black = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.35, 0.38, 0.45);

  const drawText = (
    text: string,
    opts: { size?: number; font?: typeof font; color?: ReturnType<typeof rgb>; x?: number } = {}
  ) => {
    page.drawText(sanitizePdfText(text), {
      x: opts.x ?? margin,
      y,
      size: opts.size ?? 11,
      font: opts.font ?? font,
      color: opts.color ?? black,
    });
  };

  // Simple word-wrap for body paragraphs.
  const wrap = (text: string, size = 11, maxWidth = width): string[] => {
    const words = sanitizePdfText(text).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) > maxWidth) {
        lines.push(line);
        line = w;
      } else {
        line = trial;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const drawParagraph = (text: string, size = 11, lineGap = 4) => {
    for (const line of wrap(text, size)) {
      drawText(line, { size });
      y -= size + lineGap;
    }
  };

  // Header
  drawText(company, { size: 20, font: bold });
  y -= 26;
  drawText("Home Staging Services Agreement", { size: 14, font: bold });
  y -= 16;
  drawText(`Dated ${today}`, { size: 10, color: muted });
  y -= 22;

  // Divider
  page.drawRectangle({
    x: margin,
    y,
    width,
    height: 0.75,
    color: rgb(0.85, 0.87, 0.92),
  });
  y -= 22;

  // Optional intro paragraph from the template, drawn above Parties.
  if (input.intro && input.intro.trim()) {
    drawParagraph(input.intro.trim());
    y -= 10;
  }

  // Parties
  drawText("Parties", { size: 12, font: bold });
  y -= 18;
  drawParagraph(
    `This agreement is entered into between ${company} ("Stager") and ${input.clientName} ("Client") for the staging services described below.`
  );
  y -= 6;

  // Details table
  drawText("Engagement Details", { size: 12, font: bold });
  y -= 18;
  const stageLen = input.stageLengthDays === 90 ? 90 : 60;
  const rows: [string, string][] = [
    ["Property", input.propertyAddress],
    ["Client", input.clientName + (input.clientAddress ? ` — ${input.clientAddress}` : "")],
    ["Stage date", fmtDate(input.stageDate)],
    ["Destage date", fmtDate(input.destageDate)],
    ["Rental period", `${stageLen} days`],
    ["Reference", input.stageId],
  ];
  for (const [k, v] of rows) {
    drawText(k, { size: 10, font: bold, color: muted });
    page.drawText(sanitizePdfText(v), {
      x: margin + 130,
      y,
      size: 11,
      font,
      color: black,
    });
    y -= 18;
  }
  y -= 6;

  // Itemized fees
  drawText("Fees", { size: 12, font: bold });
  y -= 18;
  const items = input.lineItems ?? [];
  const discount = input.discount ?? 0;
  for (const item of items) {
    const wrapped = wrap(item.label, 11, width - 120);
    for (let i = 0; i < wrapped.length; i++) {
      drawText(wrapped[i], { size: 11 });
      if (i === 0) {
        const priceText = fmtMoney(item.amount);
        page.drawText(priceText, {
          x: 612 - margin - font.widthOfTextAtSize(priceText, 11),
          y,
          size: 11,
          font,
          color: black,
        });
      }
      y -= 16;
    }
  }
  if (discount > 0) {
    drawText("Discount", { size: 11, color: muted });
    const priceText = `-${fmtMoney(discount)}`;
    page.drawText(priceText, {
      x: 612 - margin - font.widthOfTextAtSize(priceText, 11),
      y,
      size: 11,
      font,
      color: muted,
    });
    y -= 16;
  }
  // Divider above total
  page.drawRectangle({
    x: margin,
    y: y + 6,
    width,
    height: 0.5,
    color: rgb(0.85, 0.87, 0.92),
  });
  y -= 4;
  drawText("Total", { size: 12, font: bold });
  const totalText = fmtMoney(input.amount);
  page.drawText(totalText, {
    x: 612 - margin - bold.widthOfTextAtSize(totalText, 12),
    y,
    size: 12,
    font: bold,
    color: black,
  });
  y -= 24;

  // Package-includes note — scope of work surfaced everywhere the
  // client sees the agreement (public estimate, contract, invoice).
  // Only meaningful when a catalog package was chosen; custom-priced
  // stages skip it.
  if (input.packageIncludesNote) {
    drawParagraph(input.packageIncludesNote, 10, 2);
    y -= 6;
  }

  // Terms — pulled from the editable template (falls back to a single
  // generic line if none were supplied so the section is never empty).
  drawText("Terms", { size: 12, font: bold });
  y -= 18;

  const terms = input.terms && input.terms.length
    ? input.terms
    : [{ title: "Agreement", body: "Standard terms apply." }];
  let i = 1;
  for (const t of terms) {
    drawParagraph(`${i}. ${t.title}. ${renderTermBody(t.body, input)}`, 10, 3);
    y -= 4;
    i += 1;
  }

  // Signature block(s) — anchored to fixed positions near the bottom of
  // page 1 so SignatureAPI's overlay (which uses the same coordinates
  // from SIGNATURE_FIELD / SECONDARY_SIGNATURE_FIELD below) lines up
  // with the visible line every time, regardless of how much body
  // content was drawn above. When a secondary signer is set, render
  // both side-by-side with smaller widths.
  const PAGE_HEIGHT = 792;
  const hasSecondary = !!input.secondaryRecipientName;
  const SIG_WIDTH = hasSecondary ? 220 : 260;

  // Header above the signature row.
  const headerY = PAGE_HEIGHT - SIGNATURE_FIELD.top + 56;
  y = headerY;
  drawText(
    hasSecondary ? "Signatures" : "Client Signature",
    { size: 12, font: bold },
  );

  const drawSigBox = (label: string, name: string, posTop: number, posLeft: number) => {
    const sigY = PAGE_HEIGHT - posTop;
    const sigX = posLeft;
    page.drawLine({
      start: { x: sigX, y: sigY - 2 },
      end: { x: sigX + SIG_WIDTH, y: sigY - 2 },
      thickness: 0.75,
      color: rgb(0.6, 0.62, 0.68),
    });
    page.drawText(sanitizePdfText(name), {
      x: sigX,
      y: sigY - 16,
      size: 10,
      font,
      color: muted,
    });
    page.drawText(label, {
      x: sigX,
      y: sigY - 30,
      size: 9,
      font,
      color: muted,
    });
  };

  drawSigBox(
    hasSecondary ? "Client" : "Client",
    input.clientName,
    SIGNATURE_FIELD.top,
    SIGNATURE_FIELD.left,
  );
  if (hasSecondary) {
    drawSigBox(
      "Co-signer",
      input.secondaryRecipientName!,
      SECONDARY_SIGNATURE_FIELD.top,
      SECONDARY_SIGNATURE_FIELD.left,
    );
  }

  return await pdf.save();
}

/**
 * Where SignatureAPI should overlay the client's signature.
 *
 * Coordinates are in PDF points using SignatureAPI's convention:
 *  - `page` is 1-indexed
 *  - `top` is the distance from the TOP of the page
 *  - `left` is the distance from the LEFT edge
 *
 * The PDF generator above translates `top` into pdf-lib's bottom-origin
 * y-coordinate via PAGE_HEIGHT - top.
 */
export const SIGNATURE_FIELD = {
  page: 1,
  top: 682, // PAGE_HEIGHT (792) - 110 = 682 from top
  left: 56,
} as const;

/**
 * Where SignatureAPI overlays the secondary signer's signature when a
 * secondary recipient is set on the stage. Positioned side-by-side
 * with SIGNATURE_FIELD so both fit on the same row of page 1.
 */
export const SECONDARY_SIGNATURE_FIELD = {
  page: 1,
  top: 682,
  left: 336, // 56 (left) + 220 (width) + 60 gap
} as const;
