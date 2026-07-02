// Reusable signature-send pipeline. Takes an explicit Supabase client
// so it can run from either:
//   - the authenticated server action (cookie-based client), or
//   - the anonymous estimate-accept flow (service-role admin client).
//
// Throws on any error so callers can decide whether to surface it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createEnvelope } from "./signature";
import {
  generateContractPdf,
  SIGNATURE_FIELD,
  SECONDARY_SIGNATURE_FIELD,
} from "./contract-pdf";
import {
  DEFAULT_TEMPLATE,
  type ContractTemplate,
  type ContractTerm,
} from "./contract-template";
import {
  computePrice,
  ESCROW_FEE,
  PACKAGE_INCLUDES,
  parseLineItems,
  sumLineItems,
  type SelectedAddOn,
} from "./pricing";

export async function sendSignatureFromStage(
  supabase: SupabaseClient,
  stageId: string
): Promise<void> {
  const { data: stage } = await supabase
    .from("stages")
    .select(
      "id, address, amount, stage_date, destage_date, stage_length_days, package_key, add_ons, discount, escrow, travel_fee, line_items, secondary_recipient_name, secondary_recipient_email, signature_envelope_id, client:clients(id, name, email, address)"
    )
    .eq("id", stageId)
    .single();
  if (!stage) throw new Error("Stage not found");
  // The PostgREST FK alias can come back as either a single row or an
  // array depending on the query shape — handle both.
  const client = Array.isArray(stage.client) ? stage.client[0] : stage.client;
  const c = client as
    | { id: string; name: string; email: string | null; address: string | null }
    | null
    | undefined;
  if (!c?.email) {
    throw new Error(
      "The client on this stage has no email on file — add one on the client's page first."
    );
  }

  // Contract template lookup. Service-role bypasses the RLS that gates
  // the table to authenticated users, so this works from both callers.
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
    // Fall back to defaults — better than blocking the signature send.
  }

  const breakdown = computePrice(
    stage.package_key,
    (stage.add_ons ?? []) as SelectedAddOn[],
    Number(stage.discount ?? 0)
  );
  // Custom-priced stages (no package_key but a saved amount) get a
  // single "Home staging" line item instead of the catalog breakdown
  // so the contract PDF still renders the correct total. Escrow fee
  // (when enabled) is appended as its own line item regardless of
  // pricing mode.
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
  const lineItems = [
    ...(isCustomPrice
      ? [{ label: "Home staging", amount: customSubtotal }]
      : [
          ...(breakdown.package
            ? [
                {
                  label: breakdown.package.label,
                  amount: breakdown.package.price,
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
    ...(escrowOn
      ? [{ label: "Escrow payment fee", amount: ESCROW_FEE }]
      : []),
    ...(travelFee > 0
      ? [{ label: "Travel fee", amount: travelFee }]
      : []),
  ];

  // Optional second signer (homeowner / co-payer). Both must sign for
  // the envelope to finalize; their signature field is rendered on the
  // contract at SECONDARY_SIGNATURE_FIELD.
  const secondaryName =
    typeof stage.secondary_recipient_name === "string"
      ? stage.secondary_recipient_name.trim()
      : "";
  const secondaryEmail =
    typeof stage.secondary_recipient_email === "string"
      ? stage.secondary_recipient_email.trim()
      : "";
  const hasSecondary = !!(secondaryName && secondaryEmail);

  const pdfBytes = await generateContractPdf({
    companyName: template.company_name,
    clientName: c.name,
    clientAddress: c.address,
    propertyAddress: stage.address,
    amount: Number(stage.amount),
    stageDate: stage.stage_date,
    destageDate: stage.destage_date,
    stageLengthDays:
      stage.stage_length_days === 60 || stage.stage_length_days === 90
        ? stage.stage_length_days
        : 60,
    secondaryRecipientName: hasSecondary ? secondaryName : null,
    stageId: stage.id,
    lineItems,
    discount: isCustomPrice ? 0 : breakdown.discount,
    intro: template.intro,
    terms: template.terms,
    packageIncludesNote: breakdown.package ? PACKAGE_INCLUDES : null,
  });

  const path = `${stage.id}/${Date.now()}-${crypto.randomUUID()}.pdf`;
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

  const envelope = await createEnvelope({
    title: `Staging Agreement — ${stage.address}`,
    documentUrl: urlData.publicUrl,
    recipient: { name: c.name, email: c.email },
    position: SIGNATURE_FIELD,
    ...(hasSecondary
      ? {
          secondaryRecipient: { name: secondaryName, email: secondaryEmail },
          secondaryPosition: SECONDARY_SIGNATURE_FIELD,
        }
      : {}),
  });

  await supabase
    .from("stages")
    .update({
      signature_envelope_id: envelope.id,
      signature_status: envelope.status || "sent",
      signature_sent_at: new Date().toISOString(),
      signature_signer_email: c.email,
      signature_completed_at: null,
      signed_pdf_url: null,
    })
    .eq("id", stage.id);
}
