"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { invoiceNumberFor } from "@/lib/invoice-pdf";
import {
  DEFAULT_INVOICE_PAYMENT_TERMS,
  invoiceTotal,
  parseInvoiceLineItems,
} from "@/lib/custom-invoice";
import {
  generateCustomInvoicePdf,
  sendCustomInvoiceEmail,
} from "@/lib/custom-invoice-core";

export type InvoiceActionResult = { ok: true } | { ok: false; error: string };

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function str(fd: FormData, key: string, max = 2000): string {
  return String(fd.get(key) ?? "").trim().slice(0, max);
}

function dateOrNull(v: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Resolve the Bill To block from the form. Either a client (existing
 * pick or inline create via <ClientSelect />), or a one-off name/email
 * with no client row at all. The result is snapshotted onto the invoice.
 */
async function resolveBillTo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fd: FormData,
): Promise<{
  client_id: string | null;
  bill_to_name: string;
  bill_to_email: string | null;
  bill_to_address: string | null;
}> {
  const mode = str(fd, "bill_mode") === "other" ? "other" : "client";
  if (mode === "other") {
    const name = str(fd, "bill_to_name", 200);
    if (!name) throw new Error("Enter who this invoice is billed to.");
    return {
      client_id: null,
      bill_to_name: name,
      bill_to_email: str(fd, "bill_to_email", 200).toLowerCase() || null,
      bill_to_address: str(fd, "bill_to_address", 500) || null,
    };
  }

  let clientId = str(fd, "client_id", 64);
  const newClientName = str(fd, "new_client_name", 200);
  if (!clientId && newClientName) {
    const { data: created, error } = await supabase
      .from("clients")
      .insert({
        name: newClientName,
        email: str(fd, "new_client_email", 200) || null,
        phone: str(fd, "new_client_phone", 50) || null,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Could not create client: ${error.message}`);
    clientId = created.id;
    revalidatePath("/clients");
  }
  if (!clientId) throw new Error("Pick a client, or switch to billing someone else.");

  const { data: client, error } = await supabase
    .from("clients")
    .select("id, name, email, address")
    .eq("id", clientId)
    .single();
  if (error || !client) throw new Error("Client not found.");
  return {
    client_id: client.id,
    bill_to_name: client.name,
    // A per-invoice email override beats the client's default (e.g. a
    // seller paying a split invoice).
    bill_to_email:
      str(fd, "bill_to_email", 200).toLowerCase() ||
      (client.email ? String(client.email).trim().toLowerCase() : null),
    bill_to_address: client.address ?? null,
  };
}

function parseBody(fd: FormData) {
  const items = parseInvoiceLineItems(fd.get("line_items"));
  if (items.length === 0) throw new Error("Add at least one line item.");
  const discountRaw = Number(fd.get("discount") ?? 0);
  const discount = Number.isFinite(discountRaw) && discountRaw > 0 ? Math.round(discountRaw * 100) / 100 : 0;
  const total = invoiceTotal(items, discount);
  if (total <= 0) throw new Error("The invoice total must be more than $0.");
  const title = str(fd, "title", 200);
  if (!title) throw new Error("Give the invoice a title (e.g. Cleaning fee).");
  const today = new Date().toISOString().slice(0, 10);
  return {
    title,
    reference: str(fd, "reference", 300) || null,
    line_items: items,
    discount,
    total,
    invoice_date: dateOrNull(str(fd, "invoice_date", 10)) ?? today,
    due_date: dateOrNull(str(fd, "due_date", 10)),
    payment_terms: str(fd, "payment_terms", 300) || DEFAULT_INVOICE_PAYMENT_TERMS,
    notes: str(fd, "notes", 4000) || null,
    include_staging_terms: fd.get("include_staging_terms") === "on",
    stage_id: str(fd, "stage_id", 64) || null,
  };
}

export async function createInvoiceAction(formData: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const billTo = await resolveBillTo(supabase, formData);
  const body = parseBody(formData);

  // The number is derived from the id + date, so mint the id up front.
  const id = randomUUID();
  const { error } = await supabase.from("invoices").insert({
    id,
    invoice_number: invoiceNumberFor(id, body.invoice_date),
    ...billTo,
    ...body,
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  // Best-effort PDF so the detail page has something to open right away.
  try {
    await generateCustomInvoicePdf(supabase, id);
  } catch (e) {
    console.error("[createInvoiceAction] pdf failed:", e);
  }

  revalidatePath("/invoices");
  revalidatePath("/");
  if (billTo.client_id) revalidatePath(`/clients/${billTo.client_id}`);
  if (body.stage_id) revalidatePath(`/stages/${body.stage_id}`);
  redirect(`/invoices/${id}`);
}

export async function updateInvoiceAction(id: string, formData: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("invoices")
    .select("id, status, client_id, stage_id")
    .eq("id", id)
    .single();
  if (!existing) throw new Error("Invoice not found.");
  if (existing.status === "paid" || existing.status === "void") {
    throw new Error("Paid and void invoices can't be edited.");
  }

  const billTo = await resolveBillTo(supabase, formData);
  const body = parseBody(formData);
  const { error } = await supabase
    .from("invoices")
    .update({ ...billTo, ...body })
    .eq("id", id);
  if (error) throw new Error(error.message);

  try {
    await generateCustomInvoicePdf(supabase, id);
  } catch (e) {
    console.error("[updateInvoiceAction] pdf failed:", e);
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/");
  for (const c of [existing.client_id, billTo.client_id]) {
    if (c) revalidatePath(`/clients/${c}`);
  }
  for (const s of [existing.stage_id, body.stage_id]) {
    if (s) revalidatePath(`/stages/${s}`);
  }
  redirect(`/invoices/${id}`);
}

export async function sendInvoiceAction(id: string): Promise<InvoiceActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const r = await sendCustomInvoiceEmail(supabase, id);
  if (!r.ok) return r;
  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  revalidatePath("/");
  return { ok: true };
}

export async function regenerateInvoicePdfAction(id: string): Promise<InvoiceActionResult> {
  await requireAdmin();
  try {
    const supabase = await createClient();
    await generateCustomInvoicePdf(supabase, id);
    revalidatePath(`/invoices/${id}`);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: errMsg(e, "Couldn't build the PDF.") };
  }
}

export async function recordInvoicePaymentAction(
  invoiceId: string,
  formData: FormData,
): Promise<InvoiceActionResult> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not signed in");

    const amount = Number(formData.get("amount"));
    if (!amount || !Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: "Enter a positive amount." };
    }
    const paidAt =
      dateOrNull(str(formData, "paid_at", 10)) ?? new Date().toISOString().slice(0, 10);
    const methodRaw = str(formData, "method", 20).toLowerCase();
    const allowed = ["check", "cash", "zelle", "card", "other"];
    const method = allowed.includes(methodRaw) ? methodRaw : null;
    const note = str(formData, "note", 500) || null;

    const { error } = await supabase.from("invoice_payments").insert({
      invoice_id: invoiceId,
      amount,
      paid_at: paidAt,
      method,
      note,
      created_by: user.id,
    });
    if (error) throw new Error(error.message);

    const { data: inv } = await supabase
      .from("invoices")
      .select("invoice_number, title, stage_id, client_id")
      .eq("id", invoiceId)
      .maybeSingle();
    await logActivity(supabase, {
      kind: "payment_recorded",
      stageId: inv?.stage_id ?? null,
      stageAddress: inv ? `${inv.title} (${inv.invoice_number})` : null,
      details: { amount, method, paid_at: paidAt, invoice_id: invoiceId },
    });

    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices");
    revalidatePath("/");
    revalidatePath("/finance");
    if (inv?.client_id) revalidatePath(`/clients/${inv.client_id}`);
    if (inv?.stage_id) revalidatePath(`/stages/${inv.stage_id}`);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: errMsg(e, "Couldn't record payment.") };
  }
}

export async function deleteInvoicePaymentAction(
  paymentId: string,
  invoiceId: string,
): Promise<InvoiceActionResult> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase
      .from("invoice_payments")
      .delete()
      .eq("id", paymentId)
      .eq("invoice_id", invoiceId);
    if (error) throw new Error(error.message);
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath("/invoices");
    revalidatePath("/");
    revalidatePath("/finance");
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: errMsg(e, "Delete failed") };
  }
}

/** Void (or restore) an invoice. Voiding keeps the record; nothing is emailed. */
export async function setInvoiceVoidAction(
  id: string,
  makeVoid: boolean,
): Promise<InvoiceActionResult> {
  try {
    await requireAdmin();
    const supabase = await createClient();
    const { data: inv } = await supabase
      .from("invoices")
      .select("status, sent_at, total")
      .eq("id", id)
      .single();
    if (!inv) return { ok: false, error: "Invoice not found." };

    let next: string;
    if (makeVoid) {
      next = "void";
    } else {
      // Restoring: let the ledger decide paid vs. open.
      const { data: pays } = await supabase
        .from("invoice_payments")
        .select("amount")
        .eq("invoice_id", id);
      const paid = (pays ?? []).reduce(
        (s: number, p: { amount: number | string | null }) => s + Number(p.amount ?? 0),
        0,
      );
      next =
        Number(inv.total) > 0 && paid >= Number(inv.total)
          ? "paid"
          : inv.sent_at
            ? "sent"
            : "draft";
    }
    const { error } = await supabase.from("invoices").update({ status: next }).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath(`/invoices/${id}`);
    revalidatePath("/invoices");
    revalidatePath("/");
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: errMsg(e, "Update failed") };
  }
}

/** Delete an invoice that has no payments recorded. Otherwise void it. */
export async function deleteInvoiceAction(id: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { count } = await supabase
    .from("invoice_payments")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", id);
  if ((count ?? 0) > 0) {
    throw new Error("This invoice has payments recorded — void it instead of deleting.");
  }
  const { data: inv } = await supabase
    .from("invoices")
    .select("client_id, stage_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/invoices");
  revalidatePath("/");
  if (inv?.client_id) revalidatePath(`/clients/${inv.client_id}`);
  if (inv?.stage_id) revalidatePath(`/stages/${inv.stage_id}`);
  redirect("/invoices");
}
