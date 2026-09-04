import InvoiceBillToFields from "./InvoiceBillToFields";
import InvoiceLineItemsFields from "./InvoiceLineItemsFields";
import SubmitButton from "./SubmitButton";
import {
  DEFAULT_INVOICE_PAYMENT_TERMS,
  type InvoiceLineItem,
} from "@/lib/custom-invoice";

type ClientOption = { id: string; name: string; email?: string | null };

export type InvoiceFormDefaults = {
  client_id?: string | null;
  bill_to_name?: string | null;
  bill_to_email?: string | null;
  bill_to_address?: string | null;
  stage_id?: string | null;
  title?: string | null;
  reference?: string | null;
  line_items?: InvoiceLineItem[];
  discount?: number;
  invoice_date?: string | null;
  due_date?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
  include_staging_terms?: boolean;
};

/**
 * Shared create/edit form for standalone invoices. Server component —
 * the interactive bits (bill-to toggle, line items) are client
 * components inside it. `action` is the bound server action.
 */
export default function InvoiceForm({
  action,
  clients,
  defaults = {},
  linkedStage,
  submitLabel,
  pendingLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  clients: ClientOption[];
  defaults?: InvoiceFormDefaults;
  /** When set, the invoice is tied to this stage and its client. */
  linkedStage?: { id: string; address: string; clientId: string | null } | null;
  submitLabel: string;
  pendingLabel: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const input =
    "mt-1 w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2.5 text-base bg-white dark:bg-slate-900";

  // A linked stage fixes the client; an existing client on the invoice
  // pre-selects it; a one-off name means "someone else" mode.
  const billMode: "client" | "other" =
    !linkedStage && !defaults.client_id && defaults.bill_to_name ? "other" : "client";

  return (
    <form action={action} className="space-y-6">
      {linkedStage && (
        <>
          <input type="hidden" name="stage_id" value={linkedStage.id} />
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-sm">
            <span className="text-slate-500 dark:text-slate-400">Linked to stage</span>
            <div className="font-medium text-slate-900 dark:text-slate-100">{linkedStage.address}</div>
          </div>
        </>
      )}

      <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold tracking-tight">Bill to</h2>
        <InvoiceBillToFields
          clients={clients}
          defaultMode={billMode}
          defaultClientId={linkedStage?.clientId ?? defaults.client_id ?? undefined}
          defaultName={defaults.bill_to_name ?? ""}
          defaultEmail={billMode === "other" ? defaults.bill_to_email ?? "" : ""}
          defaultAddress={defaults.bill_to_address ?? ""}
          lockClient={!!linkedStage?.clientId}
        />
      </section>

      <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold tracking-tight">What it&rsquo;s for</h2>
        <label className="block text-sm">
          Title *
          <input
            name="title"
            required
            defaultValue={defaults.title ?? ""}
            autoComplete="off"
            placeholder="e.g. Cleaning fee, Furniture sale, Staging deposit (50%)"
            maxLength={200}
            className={input}
          />
        </label>
        <label className="block text-sm">
          Reference
          <input
            name="reference"
            defaultValue={defaults.reference ?? linkedStage?.address ?? ""}
            autoComplete="off"
            placeholder="Property address or anything else printed under the title"
            maxLength={300}
            className={input}
          />
        </label>
        <InvoiceLineItemsFields
          defaultItems={defaults.line_items ?? []}
          defaultDiscount={defaults.discount ?? 0}
        />
      </section>

      <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
        <h2 className="text-base font-semibold tracking-tight">Dates &amp; terms</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            Invoice date
            <input
              name="invoice_date"
              type="date"
              defaultValue={defaults.invoice_date ?? today}
              className={input}
            />
          </label>
          <label className="block text-sm">
            Due date
            <input
              name="due_date"
              type="date"
              defaultValue={defaults.due_date ?? ""}
              className={input}
            />
          </label>
        </div>
        <label className="block text-sm">
          Payment terms
          <input
            name="payment_terms"
            defaultValue={defaults.payment_terms ?? DEFAULT_INVOICE_PAYMENT_TERMS}
            maxLength={300}
            className={input}
          />
          <span className="block mt-1 text-xs text-slate-500 dark:text-slate-400">
            One line under the total. Checks-payable and Zelle details always print.
          </span>
        </label>
        <label className="block text-sm">
          Notes
          <textarea
            name="notes"
            rows={3}
            defaultValue={defaults.notes ?? ""}
            placeholder="Printed on the invoice under the terms — pickup details, what was sold, anything the payer should know."
            className={input}
          />
        </label>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="include_staging_terms"
            defaultChecked={defaults.include_staging_terms ?? !!linkedStage}
            className="mt-0.5 h-4 w-4 accent-brand"
          />
          <span>
            Include the standard staging terms
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Appends the agreement&rsquo;s terms (care of furnishings, no pets,
              cancellation…). On for split stage billing; off for cleaning or
              furniture sales.
            </span>
          </span>
        </label>
      </section>

      <SubmitButton pendingLabel={pendingLabel}>{submitLabel}</SubmitButton>
    </form>
  );
}
