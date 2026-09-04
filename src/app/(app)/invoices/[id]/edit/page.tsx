import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import { requireAdmin } from "@/lib/require-admin";
import BackLink from "@/components/BackLink";
import InvoiceForm from "@/components/InvoiceForm";
import { parseInvoiceLineItems } from "@/lib/custom-invoice";
import { updateInvoiceAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = await createClient();

  const { data: inv } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, status, client_id, stage_id, bill_to_name, bill_to_email, bill_to_address, title, reference, line_items, discount, invoice_date, due_date, payment_terms, notes, include_staging_terms",
    )
    .eq("id", id)
    .maybeSingle();
  if (!inv) notFound();
  // Paid/void invoices are frozen — the detail page says why.
  if (inv.status === "paid" || inv.status === "void") redirect(`/invoices/${id}`);

  const clients = await fetchAllRows((from, to) =>
    supabase
      .from("clients")
      .select("id, name, email")
      .order("name")
      .order("id")
      .range(from, to),
  );

  let linkedStage: { id: string; address: string; clientId: string | null } | null = null;
  if (inv.stage_id) {
    const { data: s } = await supabase
      .from("stages")
      .select("id, address, city, client_id")
      .eq("id", inv.stage_id)
      .maybeSingle();
    if (s) {
      linkedStage = {
        id: s.id,
        address: [s.address, s.city].filter(Boolean).join(", "),
        clientId: s.client_id ?? null,
      };
    }
  }

  // Only surface the email as an override when it differs from the
  // client's own — otherwise the blank field means "use the client's".
  let emailDefault = inv.bill_to_email ?? "";
  if (inv.client_id) {
    const { data: c } = await supabase
      .from("clients")
      .select("email")
      .eq("id", inv.client_id)
      .maybeSingle();
    const clientEmail = (c?.email ?? "").trim().toLowerCase();
    if (clientEmail && clientEmail === (inv.bill_to_email ?? "").toLowerCase()) emailDefault = "";
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <BackLink
        fallback={`/invoices/${id}`}
        className="text-sm text-slate-700 dark:text-slate-300 hover:underline"
      >
        ← Back
      </BackLink>
      <div>
        <h1 className="text-2xl font-semibold">Edit invoice</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 font-mono">{inv.invoice_number}</p>
      </div>
      {inv.status === "sent" && (
        <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
          This invoice was already emailed. Saving rebuilds the PDF, but the
          payer still has the old link — use <strong>Resend</strong> afterwards
          so they get the updated one.
        </p>
      )}
      <InvoiceForm
        action={updateInvoiceAction.bind(null, id)}
        clients={clients ?? []}
        defaults={{
          client_id: inv.client_id,
          bill_to_name: inv.bill_to_name,
          bill_to_email: emailDefault,
          bill_to_address: inv.bill_to_address,
          stage_id: inv.stage_id,
          title: inv.title,
          reference: inv.reference,
          line_items: parseInvoiceLineItems(inv.line_items),
          discount: Number(inv.discount ?? 0),
          invoice_date: inv.invoice_date,
          due_date: inv.due_date,
          payment_terms: inv.payment_terms,
          notes: inv.notes,
          include_staging_terms: !!inv.include_staging_terms,
        }}
        linkedStage={linkedStage}
        submitLabel="Save changes"
        pendingLabel="Saving…"
      />
    </div>
  );
}
