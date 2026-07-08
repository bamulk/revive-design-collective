import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import { createEstimateAction } from "../actions";
import PackagePicker from "@/components/PackagePicker";
import ClientSelect from "@/components/ClientSelect";
import PropertyDetailsFields from "@/components/PropertyDetailsFields";
import ExtraFeesFields from "@/components/ExtraFeesFields";
import CustomLineItemsFields from "@/components/CustomLineItemsFields";
import SecondaryRecipientFields from "@/components/SecondaryRecipientFields";
import SubmitButton from "@/components/SubmitButton";
import { requireEstimateAccess } from "@/lib/permissions";

export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {

  await requireEstimateAccess();
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
      <Link href="/estimates" className="text-sm text-slate-700 dark:text-slate-300 hover:underline">
        ← Estimates
      </Link>
      <h1 className="text-2xl font-semibold">New estimate</h1>
      <form
        action={createEstimateAction}
        className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3"
      >
        <ClientSelect clients={clients ?? []} defaultClientId={client} />
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            Tentative stage date
            <input
              name="stage_date"
              type="date"
              className="mt-1 w-full border rounded px-3 py-2.5 text-base"
            />
          </label>
          <label className="block text-sm">
            Tentative destage date
            <input
              name="destage_date"
              type="date"
              className="mt-1 w-full border rounded px-3 py-2.5 text-base"
            />
          </label>
        </div>

        <label className="block text-sm">
          Notes (internal — not shown to client)
          <textarea
            name="notes"
            rows={3}
            className="mt-1 w-full border rounded px-3 py-2.5 text-base"
          />
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

        <SubmitButton pendingLabel="Creating estimate…">
          Create estimate
        </SubmitButton>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          You&apos;ll get a shareable link on the next page to send to the
          client.
        </p>
      </form>
    </div>
  );
}
