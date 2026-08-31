// Reusable invoice-PDF pipeline. Mirrors lib/signature-send-core.ts —
// takes an explicit Supabase client so it can run from:
//   - the authenticated server action (cookie client)
//   - the signature webhook (service-role admin client)
//   - the sync / mark-signed actions
// so we can auto-generate the invoice the moment a signature lands.

import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TEMPLATE, type ContractTemplate, type ContractTerm } from "./contract-template";
import { buildStagePricing } from "@/lib/stage-pricing";
import { stagedRoomsSummary } from "@/lib/staged-rooms";
import { generateInvoicePdf, invoiceNumberFor } from "./invoice-pdf";

export async function generateInvoiceFor(
  supabase: SupabaseClient,
  stageId: string
): Promise<{ url: string }> {
  const { data: stage } = await supabase
    .from("stages")
    .select(
      "id, address, amount, stage_date, destage_date, stage_length_days, package_key, add_ons, discount, travel_fee, line_items, staged_rooms, bill_to, homeowner_name, homeowner_email, client:clients(name, email, address)"
    )
    .eq("id", stageId)
    .single();
  if (!stage) throw new Error("Stage not found");
  const client = Array.isArray(stage.client) ? stage.client[0] : stage.client;
  if (!client) throw new Error("This stage has no client");

  // Pull the company name + terms from the editable template; falls
  // back to defaults if the row is missing (e.g. RLS denies anon).
  let template: ContractTemplate = DEFAULT_TEMPLATE;
  try {
    const { data: tmpl } = await supabase
      .from("contract_template")
      .select("company_name, intro, terms")
      .eq("id", 1)
      .single();
    if (tmpl) {
      const terms = Array.isArray(tmpl.terms)
        ? (tmpl.terms as ContractTerm[])
        : [];
      template = {
        company_name: tmpl.company_name || DEFAULT_TEMPLATE.company_name,
        intro: tmpl.intro,
        terms: terms.length ? terms : DEFAULT_TEMPLATE.terms,
      };
    }
  } catch {
    // ignore — defaults are fine
  }

  // The picked rooms print as the scope sub-line under the staging line
  // item (null when none are checked, so nothing renders).
  const roomsNote = stagedRoomsSummary((stage as any).staged_rooms);
  const pricing = buildStagePricing(stage, {
    ...(roomsNote ? { packageNote: roomsNote } : {}),
  });
  const lineItems = pricing.lineItems;

  const today = new Date().toISOString().slice(0, 10);
  const invoiceNumber = invoiceNumberFor(stage.id, today);
  const invoiceTotal = pricing.total;

  const c = client as {
    name: string;
    email: string | null;
    address: string | null;
  };

  // Recipient override: bill the homeowner when one is on file
  // (realtor-intake flow); otherwise the stage's client.
  const homeownerName =
    typeof (stage as any).homeowner_name === "string"
      ? (stage as any).homeowner_name.trim()
      : "";
  const homeownerEmail =
    typeof (stage as any).homeowner_email === "string"
      ? (stage as any).homeowner_email.trim()
      : "";
  const hasHomeowner = !!(homeownerName && homeownerEmail);

  const pdfBytes = await generateInvoicePdf({
    companyName: template.company_name,
    invoiceNumber,
    invoiceDate: today,
    // Payment is due ON STAGE DAY (business rule; the reminder engine
    // keys off the same date) — never the destage date, which read as
    // 30/60-day payment terms on the printed invoice.
    dueDate: stage.stage_date ?? null,
    clientName: hasHomeowner ? homeownerName : c.name,
    billTo: (stage as any).bill_to ?? null,
    clientEmail: hasHomeowner ? homeownerEmail : c.email,
    clientAddress: hasHomeowner ? null : c.address,
    propertyAddress: stage.address,
    stageDate: stage.stage_date,
    destageDate: stage.destage_date,
    stageLengthDays:
      stage.stage_length_days === 60 || stage.stage_length_days === 90
        ? stage.stage_length_days
        : 60,
    lineItems,
    discount: pricing.discount,
    total: invoiceTotal,
    paymentTerms: "Payment due on the day of staging.",
    // The big Terms block at the bottom replaces the old free-form
    // paymentInstructions string.
    paymentInstructions: null,
    // Scope-of-work block is off on invoices for now — restore with
    // `pricing.isCustomPrice ? null : PACKAGE_INCLUDES`.
    packageIncludesNote: null,
    terms: [
      "Additional 30-day extensions available for 50% of the original stage amount.",
      "$100 fee if staging team cannot access house the day of staging or destaging.",
      "Revive Design Collective reserves the right to destage after contract time has ended.",
      "Please make checks payable to: Revive Design Collective.",
      "Zelle: 530-251-3898 (Williams Real Estate Services).",
      "Client agrees the selection of furnishings is at the sole discretion of the stager.",
      "Client agrees that the furnishings are owned and leased by Revive Design Collective for display purposes only. While on the property, furnishings are to remain staged and are not to be used in any other fashion.",
      "Client agrees to exercise all due care in keeping, caring for, and preserving the furnishings. Cleaning fee starts at $600.",
      "Client shall remain responsible for all loss or damages to the furnishings while they are on the property; up to and including actual replacement value for each missing or damaged item.",
      "Client agrees that photographs from the listing may be used for publicity on Revive Design Collective social media sites, website, and other marketing materials.",
      "NO PETS. Occupied staging \u2014 a cleaning fee will be charged if the furniture is returned with pet hair, dirt, or any stains. Please cover all staging furniture with linens.",
      "Cancellation fee \u2014 please note that we book 2-3 weeks in advance and your stage is part of a chain of events; if you decide to cancel, there will be a $1,000 fee.",
      "Home must be clean prior to staging.",
      "Only Revive Design Co is allowed on the property during staging and de-staging. The presence of contractors slows down the process and workflow of our team.",
      "We work hard to provide staging for a number of clients in the same timeframe. Due to real estate timelines, a contractor lockbox is required to be on site for the move in and the move out. We are unable to meet realtors at the property at a specific time. Please note that we start as early as 7am and do not work past 1pm.",
    ],
  });

  const path = `invoices/${stage.id}-${Date.now()}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("contracts")
    .upload(path, pdfBytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (upErr) throw new Error(upErr.message);

  const { data: urlData } = supabase.storage
    .from("contracts")
    .getPublicUrl(path);

  await supabase
    .from("stages")
    .update({
      invoice_pdf_url: urlData.publicUrl,
      invoice_generated_at: new Date().toISOString(),
    })
    .eq("id", stage.id);

  return { url: urlData.publicUrl };
}
