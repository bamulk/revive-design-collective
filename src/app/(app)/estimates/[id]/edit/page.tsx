import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import { updateEstimateAction } from "../../actions";
import PackagePicker from "@/components/PackagePicker";
import ClientSelect from "@/components/ClientSelect";
import PropertyDetailsFields from "@/components/PropertyDetailsFields";
import ExtraFeesFields from "@/components/ExtraFeesFields";
import CustomLineItemsFields from "@/components/CustomLineItemsFields";
import SecondaryRecipientFields from "@/components/SecondaryRecipientFields";
import SubmitButton from "@/components/SubmitButton";
import { requireEstimateAccess } from "@/lib/permissions";
import { parseLineItems, type SelectedAddOn } from "@/lib/pricing";

/**
 * Edit an existing pending estimate. Mirrors /estimates/new but
 * pre-fills every field from the stage row and submits to
 * updateEstimateAction. Only reachable for rows still in `status =
 * 'estimate'` — accepted / declined estimates 404 here.
 */
export default async function EditEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireEstimateAccess();
  const { id } = await params;
  const supabase = await createClient();
  const { data: stage } = await supabase
    .from("stages")
    .select(
      "id, client_id, address, city, square_footage, bedrooms, bathrooms, zillow_url, primary_only, amount, package_key, add_ons, discount, escrow, travel_fee, line_items, stage_date, destage_date, stage_length_days, notes, status, secondary_recipient_name, secondary_recipient_email",
    )
    .eq("id", id)
    .single();
  if (!stage || stage.status !== "estimate") notFound();

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

  const action = updateEstimateAction.bind(null, id);
  const addOns = (stage.add_ons ?? []) as SelectedAddOn[];

  return (
    <div className="space-y-6 max-w-2xl">
      <Link
        href={`/estimates/${id}`}
        className="text-sm text-slate-700 dark:text-slate-300 hover:underline"
      >
        ← Back to estimate
      </Link>
      <h1 className="text-2xl font-semibold">Edit estimate</h1>
      <form
        action={action}
        className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3"
      >
        <ClientSelect
          clients={clients ?? []}
          defaultClientId={stage.client_id ?? undefined}
        />
        <label className="block text-sm">
          Address *
          <input
            name="address"
            required
            defaultValue={stage.address ?? ""}
            autoComplete="off"
            className="mt-1 w-full border rounded px-3 py-2.5 text-base"
          />
        </label>
        <label className="block text-sm">
          City
          <input
            name="city"
            defaultValue={stage.city ?? ""}
            autoComplete="off"
            className="mt-1 w-full border rounded px-3 py-2.5 text-base"
          />
        </label>
        <PropertyDetailsFields
          defaultSquareFootage={stage.square_footage ?? ""}
          defaultBedrooms={stage.bedrooms ?? ""}
          defaultBathrooms={
            stage.bathrooms != null ? Number(stage.bathrooms) : ""
          }
        />
        {stage.zillow_url && (
          <input type="hidden" name="zillow_url" value={stage.zillow_url} />
        )}
        <PackagePicker
          defaultPackageKey={stage.package_key ?? null}
          defaultAddOns={addOns}
          defaultDiscount={Number(stage.discount ?? 0)}
          defaultCustomAmount={Number(stage.amount ?? 0)}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            Tentative stage date
            <input
              name="stage_date"
              type="date"
              defaultValue={stage.stage_date ?? ""}
              className="mt-1 w-full border rounded px-3 py-2.5 text-base"
            />
          </label>
          <label className="block text-sm">
            Tentative destage date
            <input
              name="destage_date"
              type="date"
              defaultValue={stage.destage_date ?? ""}
              className="mt-1 w-full border rounded px-3 py-2.5 text-base"
            />
          </label>
        </div>

        <label className="block text-sm">
          Notes (internal — not shown to client)
          <textarea
            name="notes"
            rows={3}
            defaultValue={stage.notes ?? ""}
            className="mt-1 w-full border rounded px-3 py-2.5 text-base"
          />
        </label>

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="primary_only"
            defaultChecked={!!stage.primary_only}
            className="mt-0.5 h-4 w-4 accent-brand"
          />
          <span>
            Primary only
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Stage only the primary living areas — not every room.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="extended_stage"
            defaultChecked={stage.stage_length_days === 90}
            className="mt-0.5 h-4 w-4 accent-brand"
          />
          <span>
            Extended 90-day stage
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              90-day rental period instead of the standard 60.
            </span>
          </span>
        </label>

        <ExtraFeesFields
          defaultEscrow={!!stage.escrow}
          defaultTravelFee={Number(stage.travel_fee ?? 0)}
        />

        <CustomLineItemsFields defaultItems={parseLineItems(stage.line_items)} />

        <SecondaryRecipientFields
          defaultEnabled={!!(stage.secondary_recipient_name && stage.secondary_recipient_email)}
          defaultName={stage.secondary_recipient_name ?? ""}
          defaultEmail={stage.secondary_recipient_email ?? ""}
        />

        <SubmitButton pendingLabel="Saving estimate…">
          Save changes
        </SubmitButton>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          After saving, go back to the estimate page and tap{" "}
          <span className="font-medium">Resend</span> if you want the client to
          receive the updated version.
        </p>
      </form>
    </div>
  );
}
