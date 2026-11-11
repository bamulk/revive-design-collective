import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/fetch-all";
import NewStageForm from "@/components/NewStageForm";
import PackagePicker from "@/components/PackagePicker";
import ClientSelect from "@/components/ClientSelect";
import PhotoPicker from "@/components/PhotoPicker";
import PropertyDetailsFields from "@/components/PropertyDetailsFields";
import BackLink from "@/components/BackLink";
import ExtraFeesFields from "@/components/ExtraFeesFields";
import CustomLineItemsFields from "@/components/CustomLineItemsFields";
import StagedRoomsFields from "@/components/StagedRoomsFields";
import StageLengthField from "@/components/StageLengthField";
import SecondaryRecipientFields from "@/components/SecondaryRecipientFields";
import SubmitButton from "@/components/SubmitButton";
import { requireAdmin } from "@/lib/require-admin";
import { isR2Configured } from "@/lib/r2";

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
      .select("id, name, email")
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
      {/* Videos upload straight to R2 after the stage exists; without
          R2 the 50 MB Supabase ceiling makes them a poor fit here, so the
          picker stays photos-only and the stage page handles video. */}
      <NewStageForm
        className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3"
        videoMaxBytes={isR2Configured() ? 2 * 1024 * 1024 * 1024 : 0}
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
        <StagedRoomsFields />
        <label className="block text-sm">
          Note for the client
          <textarea
            name="agent_note"
            rows={3}
            placeholder="e.g. Includes patio furniture. Pickup of the dining set is scheduled separately."
            className="mt-1 w-full border rounded px-3 py-2.5 text-base"
          />
          <span className="block mt-1 text-xs text-slate-500 dark:text-slate-400">
            Printed on the invoice and included in the invoice email, and in the agent&rsquo;s who-signs email. Leave blank to omit it.
          </span>
        </label>
        <label className="block text-sm">
          Internal staff notes
          <textarea
            name="notes"
            rows={3}
            placeholder="Gate code quirks, parking, who to call. Team only."
            className="mt-1 w-full border rounded px-3 py-2.5 text-base"
          />
          <span className="block mt-1 text-xs text-slate-500 dark:text-slate-400">
            Only your team sees this. Never printed or emailed.
          </span>
        </label>

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
        <StageLengthField />
        <ExtraFeesFields />
        <SecondaryRecipientFields />
        <PhotoPicker />
        <SubmitButton pendingLabel="Creating stage…">Create stage</SubmitButton>
      </NewStageForm>
    </div>
  );
}
