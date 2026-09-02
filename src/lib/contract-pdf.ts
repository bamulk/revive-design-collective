// Dynamic PDF generator for the Home Staging Services Agreement.
//
// Produces the contract with the stage's details filled in — one page
// when the template is short, two when the editable Terms run long —
// and RETURNS the computed SignatureAPI field positions (signature +
// required Additional-Fees initials, per signer) so the overlays always
// land on the drawn lines.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { ARRIVAL_FEE_CLAUSE } from "./arrival-fees";
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
): Promise<{ bytes: Uint8Array; fields: ContractFieldPositions }> {
  const company = input.companyName || "Staging Co.";
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Staging Agreement — ${input.propertyAddress}`);
  pdf.setAuthor(company);

  let page = pdf.addPage([612, 792]); // US Letter
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 56;
  const width = 612 - margin * 2;
  let y = 792 - margin;

  const black = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.35, 0.38, 0.45);

  /**
   * Start a fresh page when the next `needed` points wouldn't fit above
   * the bottom margin. Without this a long Terms list (the editable
   * template can run to a dozen-plus clauses) just ran off the page and
   * the remainder was silently lost.
   */
  const breakIfNeeded = (needed: number) => {
    if (y - needed < margin) {
      page = pdf.addPage([612, 792]);
      y = 792 - margin;
    }
  };

  const drawText = (
    text: string,
    opts: { size?: number; font?: typeof font; color?: ReturnType<typeof rgb>; x?: number } = {}
  ) => {
    breakIfNeeded((opts.size ?? 11) + 4);
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
      breakIfNeeded(size + lineGap);
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
    // Don't strand a clause's opening line alone at the page foot.
    breakIfNeeded(3 * (10 + 3));
    drawParagraph(`${i}. ${t.title}. ${renderTermBody(t.body, input)}`, 10, 3);
    y -= 4;
    i += 1;
  }

  // ---- Additional Fees (initialed) + Signatures --------------------
  // FLOWED after the terms — spilling onto a fresh page when the
  // template runs long — instead of fixed coordinates, which the
  // editable Terms list had already grown past. SignatureAPI field
  // positions are computed from the actual layout and returned to the
  // caller, so the overlays always land on the drawn lines.
  const PAGE_HEIGHT = 792;
  const hasSecondary = !!input.secondaryRecipientName;
  const SIG_WIDTH = hasSecondary ? 220 : 260;
  const SECOND_COL = 336; // 56 (left) + 220 (width) + 60 gap
  const currentPage = () => pdf.getPageCount(); // 1-indexed
  const ensureSpace = breakIfNeeded;
  const toPos = (baselineY: number, left: number): ContractFieldPos => ({
    page: currentPage(),
    top: PAGE_HEIGHT - baselineY,
    left,
  });

  // Additional Fees block (client initials required).
  const feeLines = wrap(ARRIVAL_FEE_CLAUSE, 9);
  ensureSpace(24 + 16 + feeLines.length * 12 + 52 + 36);
  y -= 14;
  drawText("Additional Fees (please initial)", { size: 11, font: bold });
  y -= 16;
  for (const line of feeLines) {
    drawText(line, { size: 9 });
    y -= 12;
  }
  // Clear vertical room before the initials line so the 24pt initials
  // box (anchored at the line, drawn upward) never overlaps the clause
  // above it.
  y -= 52;
  const drawInitialsBox = (name: string, left: number) => {
    page.drawLine({
      start: { x: left, y: y - 2 },
      end: { x: left + 90, y: y - 2 },
      thickness: 0.75,
      color: rgb(0.6, 0.62, 0.68),
    });
    page.drawText(sanitizePdfText(`Initials — ${name}`), {
      x: left,
      y: y - 13,
      size: 8,
      font,
      color: muted,
    });
  };
  drawInitialsBox(input.clientName, margin);
  const initials = toPos(y, margin);
  let secondaryInitials: ContractFieldPos | undefined;
  if (hasSecondary) {
    drawInitialsBox(input.secondaryRecipientName!, SECOND_COL);
    secondaryInitials = toPos(y, SECOND_COL);
  }
  y -= 34;

  // Signature block(s). Same anchor/line relationship as before: the
  // overlay anchor sits 64pt below the header, the line 2pt under it.
  ensureSpace(18 + 64 + 36);
  drawText(hasSecondary ? "Signatures" : "Client Signature", {
    size: 12,
    font: bold,
  });
  y -= 64; // the 60pt signature overlay draws upward from the line
  const drawSigBox = (label: string, name: string, left: number) => {
    page.drawLine({
      start: { x: left, y: y - 2 },
      end: { x: left + SIG_WIDTH, y: y - 2 },
      thickness: 0.75,
      color: rgb(0.6, 0.62, 0.68),
    });
    page.drawText(sanitizePdfText(name), {
      x: left,
      y: y - 16,
      size: 10,
      font,
      color: muted,
    });
    page.drawText(label, { x: left, y: y - 30, size: 9, font, color: muted });
  };
  drawSigBox("Client", input.clientName, margin);
  const signature = toPos(y, margin);
  let secondarySignature: ContractFieldPos | undefined;
  if (hasSecondary) {
    drawSigBox("Co-signer", input.secondaryRecipientName!, SECOND_COL);
    secondarySignature = toPos(y, SECOND_COL);
  }

  const bytes = await pdf.save();
  return {
    bytes,
    fields: {
      signature,
      initials,
      ...(secondarySignature ? { secondarySignature } : {}),
      ...(secondaryInitials ? { secondaryInitials } : {}),
    },
  };
}

/**
 * A SignatureAPI fixed position: `page` is 1-indexed, `top` is measured
 * from the TOP of the page in PDF points, `left` from the left edge.
 */
export type ContractFieldPos = { page: number; top: number; left: number };

/** Where the envelope's places must go — computed per document. */
export type ContractFieldPositions = {
  signature: ContractFieldPos;
  initials: ContractFieldPos;
  secondarySignature?: ContractFieldPos;
  secondaryInitials?: ContractFieldPos;
};
