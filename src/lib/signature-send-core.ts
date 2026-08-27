// Reusable signature-send pipeline. Takes an explicit Supabase client
// so it can run from either:
//   - the authenticated server action (cookie-based client), or
//   - the anonymous estimate-accept flow (service-role admin client).
//
// Throws on any error so callers can decide whether to surface it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createEnvelope } from "./signature";
import { buildStagePricing } from "@/lib/stage-pricing";
import { generateContractPdf } from "./contract-pdf";
import {
  DEFAULT_TEMPLATE,
  type ContractTemplate,
  type ContractTerm,
} from "./contract-template";
import { PACKAGE_INCLUDES } from "./pricing";

export async function sendSignatureFromStage(
  supabase: SupabaseClient,
  stageId: string
): Promise<void> {
  const { data: stage } = await supabase
    .from("stages")
    .select(
      "id, address, amount, stage_date, destage_date, stage_length_days, package_key, add_ons, discount, travel_fee, line_items, secondary_recipient_name, secondary_recipient_email, homeowner_name, homeowner_email, signature_envelope_id, client:clients(id, name, email, address)"
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

  // Recipient override: in the realtor-intake flow the stage's client is
  // the agent, but the homeowner (entered via the public intake form) is
  // who signs. When a homeowner is on file, they are the signer; otherwise
  // the signer is the stage's client (legacy / estimate-accept path).
  const homeownerName =
    typeof stage.homeowner_name === "string" ? stage.homeowner_name.trim() : "";
  const homeownerEmail =
    typeof stage.homeowner_email === "string"
      ? stage.homeowner_email.trim()
      : "";
  const hasHomeowner = !!(homeownerName && homeownerEmail);
  const recipientName = hasHomeowner ? homeownerName : c?.name ?? "";
  const recipientEmail = hasHomeowner ? homeownerEmail : c?.email ?? "";
  const recipientAddress = hasHomeowner ? null : c?.address ?? null;
  if (!recipientEmail) {
    throw new Error(
      "No signer email on file — enter the homeowner on the intake form, or add a client email first."
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

  const pricing = buildStagePricing(stage);
  const lineItems = pricing.lineItems;

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

  const { bytes: pdfBytes, fields } = await generateContractPdf({
    companyName: template.company_name,
    clientName: recipientName,
    clientAddress: recipientAddress,
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
    discount: pricing.discount,
    intro: template.intro,
    terms: template.terms,
    packageIncludesNote: pricing.hasPackage ? PACKAGE_INCLUDES : null,
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
    recipient: { name: recipientName, email: recipientEmail },
    // Positions come from the rendered layout (the editable terms can
    // push the blocks down or onto page 2), so the overlays always
    // land on the drawn lines. Initials on the Additional Fees block
    // are required.
    position: fields.signature,
    initialsPosition: fields.initials,
    ...(hasSecondary
      ? {
          secondaryRecipient: { name: secondaryName, email: secondaryEmail },
          secondaryPosition: fields.secondarySignature!,
          secondaryInitialsPosition: fields.secondaryInitials!,
        }
      : {}),
  });

  await supabase
    .from("stages")
    .update({
      signature_envelope_id: envelope.id,
      signature_status: envelope.status || "sent",
      signature_sent_at: new Date().toISOString(),
      signature_signer_email: recipientEmail,
      signature_completed_at: null,
      signed_pdf_url: null,
      // This envelope carries the initialed Additional Fees block.
      agreement_fee_initials: true,
    })
    .eq("id", stage.id);
}
