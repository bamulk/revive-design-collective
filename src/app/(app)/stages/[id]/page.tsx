import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Phone, MessageSquare, Mail, Navigation } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import StageEditForm from "./StageEditForm";
import {
  StageEditProvider,
  StageDetailsSwitch,
  ShowWhenViewing,
  EnterEditButton,
  CancelEditButton,
} from "./StageEditClient";
import Checklist from "./tasks/Checklist";
import PackagePicker from "@/components/PackagePicker";
import StagePhotos, { StagePhotosFallback } from "./_StagePhotos";
import { StatusBadge } from "@/components/ui";
import SignatureSendButton from "@/components/SignatureSendButton";
import NewAgreementButton from "@/components/NewAgreementButton";
import DeleteStageButton from "@/components/DeleteStageButton";
import StageDateLink from "@/components/StageDateLink";
import InvoiceSection from "@/components/InvoiceSection";
import SubmitButton from "@/components/SubmitButton";
import StagePayments, {
  StagePaymentsFallback,
} from "./_StagePayments";
import StageExtensions, {
  StageExtensionsFallback,
} from "./_StageExtensions";
import StageActivity, { StageActivityFallback } from "./_StageActivity";
import SecondaryRecipientSection from "@/components/SecondaryRecipientSection";
import CrewSection from "@/components/CrewSection";
import InlineStageFields, {
  InlineLockboxField,
  InlineNotesField,
} from "@/components/InlineStageFields";
import BackLink from "@/components/BackLink";
import ExtraFeesFields from "@/components/ExtraFeesFields";
import CustomLineItemsFields from "@/components/CustomLineItemsFields";
import AdvanceStatusButton from "@/components/AdvanceStatusButton";
import StatusControl from "@/components/StatusControl";
import StageClientControl from "@/components/StageClientControl";
import { fetchAllRows } from "@/lib/fetch-all";
import PropertyDetailsFields from "@/components/PropertyDetailsFields";
import { after } from "next/server";
import { geocodeAddress, reverseGeocodeArea } from "@/lib/geocode";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBarnCoords, haversineMiles } from "@/lib/distance";
import { formatMDY } from "@/lib/time";
import { parseLineItems, type SelectedAddOn } from "@/lib/pricing";

export default async function StageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const { edit } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: me }, { data: stage }] = await Promise.all([
    user
      ? supabase.from("profiles").select("role").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("stages")
      .select("*, clients(id, name, email, phone)")
      .eq("id", id)
      .single(),
  ]);
  if (!stage) notFound();
  const isAdmin = me?.role === "admin";
  const editing = edit === "1" && isAdmin;

  // Parallel: photos, tasks, AND the crew-profile lookup. The crew
  // fetch depends on `stage.assigned_stager_ids` (just resolved) so
  // it can ride this Promise.all instead of waiting for the photos
  // signing step to finish.
  const stageStagerIds: string[] = Array.isArray(stage.assigned_stager_ids)
    ? stage.assigned_stager_ids
    : [];
  const destageStagerIds: string[] = Array.isArray(stage.destage_stager_ids)
    ? stage.destage_stager_ids
    : [];
  const allCrewIds = Array.from(
    new Set([...stageStagerIds, ...destageStagerIds]),
  );
  // Only the queries needed for the page SHELL (header, crew, status)
  // happen here. Photos / Payments / Extensions stream in via their
  // own Suspense'd async components so the shell paints immediately
  // after the Save redirect lands.
  const [{ data: tasks }, { data: crew }] = await Promise.all([
    supabase
      .from("stage_tasks")
      .select("id, title, is_done, position")
      .eq("stage_id", id)
      .order("position", { ascending: true }),
    allCrewIds.length > 0
      ? supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", allCrewIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  // Resolve crew UUIDs -> display names from the parallel fetch above.
  const crewNameById = new Map<string, string>();
  for (const p of (crew ?? []) as any[]) {
    const full = (p.full_name ?? "").trim();
    const fallback = (p.email ?? "").split("@")[0] || "Unnamed";
    crewNameById.set(p.id, full || fallback);
  }

  // Full stager roster for the editable Crew picker. Every team member can
  // now assign crew, so fetch the whole roster (not just already-assigned
  // names). First name to match the Plan page's chip style.
  const { data: rosterRows } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("role", ["stager", "lead_stager"])
    .order("full_name", { ascending: true, nullsFirst: false });
  const stagerRoster: { id: string; name: string }[] = (rosterRows ?? []).map(
    (p: any) => {
      const full = (p.full_name ?? "").trim();
      const first = full ? full.split(/\s+/)[0] : "";
      return {
        id: p.id,
        name: first || (p.email ?? "").split("@")[0] || "Unnamed",
      };
    },
  );

  // Full client list for the admin-only "Change client" control. The
  // list grows without bound, so page past the 1000-row cap.
  const allClients: { id: string; name: string }[] = isAdmin
    ? await fetchAllRows((from, to) =>
        supabase
          .from("clients")
          .select("id, name")
          .order("name")
          .order("id")
          .range(from, to),
      )
    : [];

  // Miles-from-barn uses the cached lat/lng on the row. If it's
  // missing, we queue a background geocode (Next 16's after()) so the
  // first edit click renders immediately — the next visit will have
  // miles populated.
  const stageLat: number | null = stage.lat ?? null;
  const stageLng: number | null = stage.lng ?? null;
  const needsCoords = (stageLat == null || stageLng == null) && stage.address;
  const needsNeighborhood =
    !stage.neighborhood && (needsCoords || (stageLat != null && stageLng != null));
  if (needsCoords || needsNeighborhood) {
    after(async () => {
      try {
        const admin = createAdminClient();
        let lat = stageLat;
        let lng = stageLng;
        // Resolve coords first if missing.
        if ((lat == null || lng == null) && stage.address) {
          const base = stage.city
            ? `${stage.address}, ${stage.city}`
            : stage.address;
          const query = /,\s*[A-Z]{2}\b/.test(base) ? base : `${base}, CA`;
          const coords = await geocodeAddress(query);
          if (coords) {
            lat = coords.lat;
            lng = coords.lng;
            await admin
              .from("stages")
              .update({ lat: coords.lat, lng: coords.lng })
              .eq("id", id);
          }
        }
        // Reverse-geocode the neighborhood if we have coords + none
        // cached yet. Guard: only store it when the reverse-geocoded
        // city matches the stage's city (case-insensitive) — protects
        // against city-less stages whose cached coords landed in the
        // wrong metro.
        if (!stage.neighborhood && lat != null && lng != null) {
          const area = await reverseGeocodeArea(lat, lng);
          const cityMatches =
            !!stage.city &&
            !!area.city &&
            stage.city.trim().toLowerCase() ===
              area.city.trim().toLowerCase();
          if (area.neighborhood && cityMatches) {
            await admin
              .from("stages")
              .update({ neighborhood: area.neighborhood })
              .eq("id", id);
          }
        }
      } catch (e) {
        console.error("[stage detail background geocode]", id, e);
      }
    });
  }
  let milesFromBarn: number | null = null;
  if (stageLat != null && stageLng != null) {
    const barn = await getBarnCoords();
    if (barn) {
      milesFromBarn = haversineMiles(barn, { lat: stageLat, lng: stageLng });
    }
  }

  return (
    <StageEditProvider initialEditing={editing}>
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <BackLink
            fallback="/stages/groups"
            className="text-sm text-slate-700 dark:text-slate-300 hover:underline"
          >
            ← Back
          </BackLink>
          <h1 className="text-2xl font-semibold mt-1">{stage.address}</h1>
          {(stage.city || stage.neighborhood) && (
            <div className="text-slate-600 dark:text-slate-400 text-sm flex flex-wrap items-center gap-x-2">
              {stage.city && <span>{stage.city}</span>}
              {stage.neighborhood && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {stage.neighborhood}
                </span>
              )}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                stage.city ? `${stage.address}, ${stage.city}` : stage.address
              )}&travelmode=driving`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-900"
              title="Open driving directions in Google Maps"
            >
              <Navigation size={12} /> Google Maps
            </a>
            <a
              href={`https://maps.apple.com/?daddr=${encodeURIComponent(
                stage.city ? `${stage.address}, ${stage.city}` : stage.address
              )}&dirflg=d`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-900"
              title="Open driving directions in Apple Maps"
            >
              <Navigation size={12} /> Apple Maps
            </a>
          </div>
          <p className="text-slate-700 dark:text-slate-300 text-sm mt-2">
            Client:{" "}
            <Link
              href={`/clients/${stage.clients?.id}?from=${encodeURIComponent(`/stages/${id}`)}`}
              className="underline"
            >
              {stage.clients?.name}
            </Link>
            {isAdmin && (
              <>
                {" "}
                <StageClientControl
                  stageId={id}
                  currentClientId={stage.clients?.id ?? null}
                  clients={allClients}
                />
              </>
            )}
          </p>
          {(stage.clients?.phone || stage.clients?.email) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {stage.clients?.phone && (
                <>
                  <a
                    href={`tel:${stage.clients.phone.replace(/[^\d+]/g, "")}`}
                    className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-900"
                  >
                    <Phone size={12} /> Call
                  </a>
                  <a
                    href={`sms:${stage.clients.phone.replace(/[^\d+]/g, "")}`}
                    className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-900"
                  >
                    <MessageSquare size={12} /> Text
                  </a>
                </>
              )}
              {stage.clients?.email && (
                <a
                  href={`mailto:${stage.clients.email}`}
                  className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-900"
                >
                  <Mail size={12} /> Email
                </a>
              )}
            </div>
          )}
        </div>
        {isAdmin && (
          <ShowWhenViewing>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <EnterEditButton />
              <DeleteStageButton stageId={id} label={stage.address} />
            </div>
          </ShowWhenViewing>
        )}
      </div>

      <StageDetailsSwitch
        form={
        <StageEditForm
          stageId={id}
          className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4"
        >
          <StageDateLink />
          <label className="block text-sm">
            Address
            <input
              name="address"
              required
              defaultValue={stage.address}
              autoComplete="off"
              placeholder="123 Main St"
              className="mt-1 w-full border rounded px-3 py-2.5 text-base"
            />
          </label>
          <label className="block text-sm">
            City
            <input
              name="city"
              defaultValue={stage.city ?? ""}
              autoComplete="off"
              placeholder="Sacramento"
              className="mt-1 w-full border rounded px-3 py-2.5 text-base"
            />
          </label>
          <PropertyDetailsFields
            defaultSquareFootage={stage.square_footage ?? ""}
            defaultBedrooms={stage.bedrooms ?? ""}
            defaultBathrooms={stage.bathrooms ?? ""}
          />

          <PackagePicker
            defaultPackageKey={stage.package_key ?? null}
            defaultAddOns={(stage.add_ons ?? []) as SelectedAddOn[]}
            defaultDiscount={Number(stage.discount ?? 0)}
            defaultCustomAmount={Number(stage.amount ?? 0)}
            beforeSummary={
              <CustomLineItemsFields
                defaultItems={parseLineItems(stage.line_items)}
              />
            }
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              Status
              <select
                name="status"
                defaultValue={stage.status}
                className="mt-1 w-full border rounded px-3 py-2.5 text-base"
              >
                {["scheduled", "staged", "destaged", "completed", "cancelled"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  )
                )}
              </select>
            </label>
            <label className="block text-sm">
              Stage date
              <input
                name="stage_date"
                type="date"
                defaultValue={stage.stage_date ?? ""}
                className="mt-1 w-full border rounded px-3 py-2.5 text-base"
              />
            </label>
            <label className="block text-sm">
              Destage date
              <input
                name="destage_date"
                type="date"
                defaultValue={stage.destage_date ?? ""}
                className="mt-1 w-full border rounded px-3 py-2.5 text-base"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              Lockbox code
              <input
                name="lockbox_code"
                defaultValue={stage.lockbox_code ?? ""}
                autoComplete="off"
                placeholder="e.g. 1234"
                className="mt-1 w-full border rounded px-3 py-2.5 text-base font-mono tracking-wider"
              />
            </label>
          </div>
          <label className="block text-sm">
            Notes
            <textarea
              name="notes"
              defaultValue={stage.notes ?? ""}
              rows={4}
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
                Stage only the primary living areas (living, kitchen, master).
              </span>
            </span>
          </label>
          <ExtraFeesFields
            defaultEscrow={!!stage.escrow}
            defaultTravelFee={Number(stage.travel_fee ?? 0)}
          />
          <div className="flex flex-col sm:flex-row gap-3">
            <SubmitButton
              pendingLabel="Saving…"
              className="bg-slate-900 text-white rounded-lg px-4 py-2.5 disabled:opacity-70 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              Save
            </SubmitButton>
            <CancelEditButton />
            {/* Two-step inline confirm — same component used in the
                read-only header. Sits inside the edit form on its own
                row so accidental taps on Delete can't ship a single
                click. */}
            <div className="sm:ml-auto">
              <DeleteStageButton stageId={id} label={stage.address} />
            </div>
          </div>
        </StageEditForm>
        }
        readOnly={
        <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
          {/* Pricing/package breakdown — admin only. */}
          {isAdmin && (
            <PackagePicker
              compact
              defaultPackageKey={stage.package_key ?? null}
              defaultAddOns={(stage.add_ons ?? []) as SelectedAddOn[]}
              defaultDiscount={Number(stage.discount ?? 0)}
              defaultCustomAmount={Number(stage.amount ?? 0)}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex flex-col gap-1.5 items-start">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Status
                </span>
                <StatusBadge status={stage.status} />
                {/* Escrow tag — only when this stage is being paid
                    through escrow. Sits inline with the status pill so
                    the crew sees it at a glance. */}
                {stage.escrow && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-800 ring-1 ring-inset ring-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:ring-violet-900/60">
                    Escrow
                  </span>
                )}
                {/* Zillow listing status — updated daily by the
                    listing-monitor cron. Pending / Contingent lights
                    up rose so the team sees the destage is coming. */}
                {stage.listing_status && (
                  <span
                    className={
                      /PENDING|CONTINGENT|UNDER_CONTRACT/.test(
                        stage.listing_status,
                      )
                        ? "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-900/60"
                        : "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
                    }
                    title={
                      stage.listing_status_checked_at
                        ? `Last checked ${formatMDY(stage.listing_status_checked_at)}`
                        : "Zillow status"
                    }
                  >
                    {String(stage.listing_status)
                      .replace(/_/g, " ")
                      .toLowerCase()
                      .replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </span>
                )}
              </div>
              {/* Primary-only badge sits directly under the status pill
                  so the crew sees both pieces of info together. */}
              {stage.primary_only && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 ring-1 ring-inset ring-purple-200">
                  Primary only
                </span>
              )}
            </div>
            <div className="flex flex-col items-start gap-1.5">
              <AdvanceStatusButton stageId={id} currentStatus={stage.status} />
              <StatusControl stageId={id} currentStatus={stage.status} />
            </div>
          </div>
          {isAdmin ? (
            <InlineStageFields
              stageId={id}
              stageDate={stage.stage_date ?? null}
              destageDate={stage.destage_date ?? null}
              lockboxCode={stage.lockbox_code ?? null}
              notes={stage.notes ?? null}
              milesFromBarn={milesFromBarn}
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
              <Field label="Stage date">{formatMDY(stage.stage_date)}</Field>
              <Field label="Destage date">{formatMDY(stage.destage_date)}</Field>
              {/* Lockbox is editable by stagers too — they often set or
                  correct the code from the field. */}
              <InlineLockboxField
                stageId={id}
                lockboxCode={stage.lockbox_code ?? null}
              />
              <Field label="Miles from barn">
                {milesFromBarn != null ? (
                  <span title="Straight-line distance from 6135 Rio Linda Blvd">
                    {milesFromBarn.toFixed(1)} mi
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                      straight line
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">—</span>
                )}
              </Field>
            </div>
          )}
          {(stage.square_footage || stage.bedrooms || stage.bathrooms) && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
                <Field label="Sq ft">
                  {stage.square_footage
                    ? Number(stage.square_footage).toLocaleString()
                    : "—"}
                </Field>
                <Field label="Bedrooms">
                  {stage.bedrooms != null ? stage.bedrooms : "—"}
                </Field>
                <Field label="Bathrooms">
                  {stage.bathrooms != null ? stage.bathrooms : "—"}
                </Field>
              </div>
              {stage.zillow_url && (
                <a
                  href={stage.zillow_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800"
                >
                  View photos &amp; details on Zillow →
                </a>
              )}
            </div>
          )}
          {/* Notes box — editable by stagers & lead stagers (autosave
              on blur). Admins edit notes inline via InlineStageFields
              above. */}
          {!isAdmin && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <InlineNotesField stageId={id} notes={stage.notes ?? null} />
            </div>
          )}
        </section>
        }
      />

      <CrewSection
        stageId={id}
        roster={stagerRoster}
        staging={{
          team:
            (stage.team as "grey" | "white" | "little" | null) ?? null,
          stagerIds: stageStagerIds,
          date: stage.stage_date ?? null,
        }}
        destaging={{
          team:
            (stage.destage_team as "grey" | "white" | "little" | null) ??
            null,
          stagerIds: destageStagerIds,
          date: stage.destage_date ?? null,
        }}
      />

      <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Checklist</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Team can add and check off tasks
          </span>
        </div>
        <Checklist stageId={id} initialTasks={tasks ?? []} />
      </section>

      {/* Photos — streamed in via Suspense. The shell of the page
          (header, stage details, crew, signature, invoice, payments,
          extensions) paints immediately while the per-photo signed-URL
          minting runs in the background. */}
      <Suspense fallback={<StagePhotosFallback />}>
        <StagePhotos stageId={id} />
      </Suspense>

      {/* Signature + Invoice sections are admin-only. Employees don't
          handle contracts or billing — they just stage and destage.
          The Signature card now hosts the secondary signer / payer
          editor inline so the contract recipients live in one place. */}
      {isAdmin && (
      <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Signature</h2>
          {stage.signature_status && (
            <SignatureBadge status={stage.signature_status} />
          )}
        </div>
        {stage.signature_envelope_id ? (
          <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
            <div>
              Sent to{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {stage.signature_signer_email ?? "client"}
              </span>
              {stage.signature_sent_at && (
                <> on {formatMDY(stage.signature_sent_at)}</>
              )}
            </div>
            {(stage.signature_status ?? "")
              .toLowerCase()
              .includes("bounce") && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 space-y-2">
                <p className="font-medium">This email bounced — undeliverable.</p>
                <p>
                  The address may be mistyped. Fix the email on the{" "}
                  <Link
                    href={`/clients/${stage.clients?.id}`}
                    className="underline"
                  >
                    client&apos;s page
                  </Link>
                  , then resend to the corrected address. Plain &quot;Resend&quot;
                  won&apos;t go through — it re-uses the bounced address.
                </p>
                <NewAgreementButton
                  stageId={id}
                  label="Resend to corrected email"
                  confirmPrompt={`Send a fresh signature request to ${stage.clients?.email ?? "the client's current email"}?`}
                  confirmCta="Yes, resend"
                  successText="Sent to the corrected email."
                />
              </div>
            )}
            {stage.signed_pdf_url && (
              <a
                href={stage.signed_pdf_url}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-brand hover:underline"
              >
                View signed PDF →
              </a>
            )}
            <div className="flex flex-col gap-2">
              <SignatureSendButton stageId={id} alreadySent />
              {/* Amount changed? Send a fresh agreement at the new
                  figure instead of re-delivering the stale envelope. */}
              <NewAgreementButton stageId={id} />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              No signature request has been sent yet.
            </p>
            <SignatureSendButton stageId={id} alreadySent={false} />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Requires SIGNATURE_API_KEY and a client email on file.
            </p>
          </div>
        )}

        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          <SecondaryRecipientSection
            stageId={id}
            name={stage.secondary_recipient_name ?? null}
            email={stage.secondary_recipient_email ?? null}
            hasSignatureEnvelope={!!stage.signature_envelope_id}
            bare
          />
        </div>
      </section>
      )}

      {isAdmin && (
        <InvoiceSection
          stageId={id}
          isAdmin={isAdmin}
          invoicePdfUrl={stage.invoice_pdf_url ?? null}
          invoiceGeneratedAt={stage.invoice_generated_at ?? null}
          invoiceSentAt={stage.invoice_sent_at ?? null}
          clientEmail={stage.clients?.email ?? null}
          paidAt={stage.paid_at ?? null}
          paymentMethod={stage.payment_method ?? null}
          amount={Number(stage.amount ?? 0)}
        />
      )}

      {isAdmin && (
        <Suspense fallback={<StagePaymentsFallback />}>
          <StagePayments
            stageId={id}
            stageAmount={Number(stage.amount ?? 0)}
          />
        </Suspense>
      )}

      {/* Extensions panel (admin only) — lists every extension and
          hosts the inline Record-extension form so back-fills happen
          in the same card. */}
      {isAdmin && (
        <Suspense fallback={<StageExtensionsFallback />}>
          <StageExtensions
            stageId={id}
            destageDate={stage.destage_date ?? null}
            stageAmount={Number(stage.amount ?? 0)}
          />
        </Suspense>
      )}

      {/* Activity history for this stage (all team members). */}
      <Suspense fallback={<StageActivityFallback />}>
        <StageActivity stageId={id} />
      </Suspense>

    </div>
    </StageEditProvider>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-0.5">
        {label}
      </div>
      <div className="text-slate-900 dark:text-slate-100">{children}</div>
    </div>
  );
}

function SignatureBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone = s.includes("sign") || s.includes("complete")
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : s.includes("bounce") || s.includes("fail")
    ? "bg-rose-50 text-rose-700 ring-rose-200"
    : s.includes("view")
    ? "bg-red-50 text-red-900 ring-red-200"
    : s.includes("decline") || s.includes("cancel")
    ? "bg-rose-50 text-rose-700 ring-rose-200"
    : "bg-amber-50 text-amber-800 ring-amber-200";
  const label = s.includes("sign") || s.includes("complete")
    ? "Signed"
    : s.includes("bounce")
    ? "Email bounced"
    : s.includes("fail")
    ? "Delivery failed"
    : s.includes("view")
    ? "Viewed"
    : s.includes("decline")
    ? "Declined"
    : s.includes("cancel")
    ? "Cancelled"
    : "Sent";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ${tone}`}
    >
      {label}
    </span>
  );
}
