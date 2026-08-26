import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import { createStageAction } from "../actions";
import PackagePicker from "@/components/PackagePicker";
import ClientSelect from "@/components/ClientSelect";
import PhotoPicker from "@/components/PhotoPicker";
import PropertyDetailsFields from "@/components/PropertyDetailsFields";
import BackLink from "@/components/BackLink";
import ExtraFeesFields from "@/components/ExtraFeesFields";
import CustomLineItemsFields from "@/components/CustomLineItemsFields";
import SecondaryRecipientFields from "@/components/SecondaryRecipientFields";
import SubmitButton from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/require-admin";

export default async function NewStagePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {

  await requireAdmin();
  const { client } = await searchParams;
  const supabase = await createClient();
  // The client picker needs every client — the list grows without
  // bound, so page past the 1000-row cap.
  const clients = await fetchAllRows((from, to) =>
    supabase
      .from("clients")
      .select("id, name")
      .order("name")
      .order("id")
      .range(from, to),
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <BackLink fallback="/stages" className="text-sm text-slate-700 dark:text-slate-300 hover:underline">
        ← Back
      </BackLink>
      <h1 className="text-2xl font-semibold">New stage</h1>
      <form action={createStageAction} className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3">
        <ClientSelect
          clients={clients ?? []}
          defaultClientId={client}
          label="Realtor / Agent"
        />
        <label className="block text-sm">
          Address *
          <input
            name="address"
            required
            autoComplete="off"
            placeholder="123 Main St"
            className="mt-1 w-full border rounded px-3 py-2.5 text-base"
          />
        </label>
        <label className="block text-sm">
          City
          <input
            name="city"
            autoComplete="off"
            placeholder="Sacramento"
            className="mt-1 w-full border rounded px-3 py-2.5 text-base"
          />
        </label>
        <PropertyDetailsFields />
        <PackagePicker beforeSummary={<CustomLineItemsFields />} />

        <label className="block text-sm">
          Stage date
          <input name="stage_date" type="date" className="mt-1 w-full border rounded px-3 py-2.5 text-base" />
        </label>
        <label className="block text-sm">
          Lockbox code
          <input
            name="lockbox_code"
            autoComplete="off"
            placeholder="e.g. 1234"
            className="mt-1 w-full border rounded px-3 py-2.5 text-base font-mono tracking-wider"
          />
        </label>
        <label className="block text-sm">
          Bill to (optional)
          <input
            name="bill_to"
            autoComplete="off"
            placeholder="LLC or company to bill, e.g. 123 Main St LLC"
            className="mt-1 w-full border rounded px-3 py-2.5 text-base"
          />
          <span className="block mt-1 text-xs text-slate-500 dark:text-slate-400">
            Printed as the invoice&rsquo;s Bill To (client shown as c/o).
            Leave blank to bill the client directly.
          </span>
        </label>
        <label className="block text-sm">
          Notes
          <textarea name="notes" className="mt-1 w-full border rounded px-3 py-2.5 text-base" rows={4} />
        </label>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="primary_only"
            className="mt-0.5 h-4 w-4 accent-brand"
          />
          <span>
            Primary only
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Stage only the primary living areas (living, kitchen, master) — not every room.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="extended_stage"
            className="mt-0.5 h-4 w-4 accent-brand"
          />
          <span>
            Extended 90-day stage
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Uses a 90-day rental period instead of the standard 60. Auto-fills destage date to stage date + 90 days. Reflected on the contract and invoice.
            </span>
          </span>
        </label>
        <ExtraFeesFields />
        <SecondaryRecipientFields />
        <PhotoPicker />
        <SubmitButton pendingLabel="Creating stage…">Create stage</SubmitButton>
      </form>
    </div>
  );
}
