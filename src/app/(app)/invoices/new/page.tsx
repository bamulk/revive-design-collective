import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import { requireAdmin } from "@/lib/require-admin";
import BackLink from "@/components/BackLink";
import InvoiceForm from "@/components/InvoiceForm";
import { createInvoiceAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * New standalone invoice. `?client=` pre-selects a client; `?stage=`
 * links the invoice to a stage (and fixes its client) — the route the
 * stage page uses for split billing.
 */
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; stage?: string }>;
}) {
  await requireAdmin();
  const { client, stage } = await searchParams;
  const supabase = await createClient();

  const clients = await fetchAllRows((from, to) =>
    supabase
      .from("clients")
      .select("id, name, email")
      .order("name")
      .order("id")
      .range(from, to),
  );

  let linkedStage: { id: string; address: string; clientId: string | null } | null = null;
  if (stage) {
    const { data: s } = await supabase
      .from("stages")
      .select("id, address, city, client_id")
      .eq("id", stage)
      .maybeSingle();
    if (s) {
      linkedStage = {
        id: s.id,
        address: [s.address, s.city].filter(Boolean).join(", "),
        clientId: s.client_id ?? null,
      };
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <BackLink
        fallback="/invoices"
        className="text-sm text-slate-700 dark:text-slate-300 hover:underline"
      >
        ← Back
      </BackLink>
      <h1 className="text-2xl font-semibold">New invoice</h1>
      <InvoiceForm
        action={createInvoiceAction}
        clients={clients ?? []}
        defaults={{ client_id: client ?? null }}
        linkedStage={linkedStage}
        submitLabel="Create invoice"
        pendingLabel="Creating…"
      />
    </div>
  );
}
