import type { SupabaseClient } from "@supabase/supabase-js";
import { generateInvoicePdf, invoiceNumberFor } from "@/lib/invoice-pdf";
import { todayPacificISO } from "@/lib/time";
import {
  ARRIVAL_FEE_REASONS,
  arrivalFeeTotal,
  type ArrivalFeeReason,
} from "@/lib/arrival-fees";

const APP_NAME = "Stone Home Staging";

/**
 * Build + upload the PDF for one arrival-fee report. Takes whatever
 * Supabase client the caller has (the report action runs as the
 * signed-in crew member; the contracts bucket allows internal
 * uploads). Returns the public URL, the invoice number, and the total.
 */
export async function generateFeeInvoice(
  supabase: SupabaseClient,
  opts: {
    stageId: string;
    /** The stage_fees row id — used in the storage path so the URL is
     *  unguessable and can never collide with an earlier object. */
    feeId: string;
    reasons: ArrivalFeeReason[];
    /** 1-based count of fee invoices on this stage, for the number suffix. */
    sequence: number;
    note?: string | null;
    /** True only when this stage's SIGNED agreement carried the
     *  initialed Additional Fees block — controls the wording. */
    initialed: boolean;
  },
): Promise<{ url: string; invoiceNumber: string; amount: number }> {
  const { data: stage, error } = await supabase
    .from("stages")
    .select(
      "id, address, city, stage_date, destage_date, bill_to, client:clients(name, email, address)",
    )
    .eq("id", opts.stageId)
    .single();
  if (error || !stage) throw new Error(error?.message || "Stage not found");
  const client = Array.isArray(stage.client) ? stage.client[0] : stage.client;
  const c = client as {
    name: string;
    email: string | null;
    address: string | null;
  } | null;

  const today = todayPacificISO();
  const amount = arrivalFeeTotal(opts.reasons);
  const invoiceNumber = `${invoiceNumberFor(stage.id, today)}-F${opts.sequence}`;

  const pdfBytes = await generateInvoicePdf({
    companyName: APP_NAME,
    invoiceNumber,
    invoiceDate: today,
    dueDate: today,
    clientName: c?.name ?? "Client",
    billTo: (stage as any).bill_to ?? null,
    clientEmail: c?.email ?? null,
    clientAddress: c?.address ?? null,
    propertyAddress: stage.city
      ? `${stage.address}, ${stage.city}`
      : stage.address,
    stageDate: stage.stage_date ?? null,
    destageDate: stage.destage_date ?? null,
    lineItems: opts.reasons.map((r) => ({
      label: `${ARRIVAL_FEE_REASONS[r].label} — additional fee per staging agreement`,
      amount: ARRIVAL_FEE_REASONS[r].amount,
    })),
    discount: 0,
    total: amount,
    paymentTerms: "Payment due on receipt.",
    paymentInstructions:
      "Payable by check, cash, or Zelle to Stone Home Staging.",
    terms: [
      opts.initialed
        ? "Additional fee per the Additional Fees section of the staging agreement (initialed by client)."
        : "Additional fee per Stone Home Staging terms (access / readiness fee).",
      ...(opts.note?.trim() ? [`Crew note: ${opts.note.trim()}`] : []),
    ],
  });

  // Row uuid in the path: unguessable (the bucket is public-read) and
  // unique, so a plain insert (no upsert — the bucket has no UPDATE
  // policy) can never hit an existing object.
  const path = `fees//.pdf`;
  const { error: upErr } = await supabase.storage
    .from("contracts")
    .upload(path, pdfBytes, { contentType: "application/pdf", upsert: false });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  const { data: pub } = supabase.storage.from("contracts").getPublicUrl(path);
  return { url: pub.publicUrl, invoiceNumber, amount };
}
