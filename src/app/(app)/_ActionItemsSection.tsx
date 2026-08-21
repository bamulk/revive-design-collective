import Link from "next/link";
import { AlertTriangle, Camera, FileSignature, Clock, Receipt } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import CollapsibleSection from "@/components/CollapsibleSection";
import { formatMDY, todayPacificISO, addDaysISO } from "@/lib/time";
import { arrivalFeeLabels } from "@/lib/arrival-fees";

/**
 * "Action items" triage panel at the top of the dashboard — the things
 * that most reliably turn into fires when nobody notices:
 *
 *   1. Scheduled stages with no signed agreement ($0 internal stages
 *      exempt — no agreement expected on those)
 *   2. Staged houses that went pending on Zillow 20+ days ago (the
 *      sale should be closing — plan the destage)
 *   3. Stages happening TOMORROW with zero pictures uploaded
 *   4. Arrival-issue fee invoices waiting for an admin to approve
 *
 * Admin-only (parent gates), hides itself when everything's clear.
 */

type Item = {
  id: string;
  address: string;
  city: string | null;
  clientName: string | null;
  note: string;
  noteTone: "rose" | "amber";
};

function itemFrom(row: any, note: string, noteTone: "rose" | "amber"): Item {
  const client = Array.isArray(row.clients) ? row.clients[0] : row.clients;
  return {
    id: row.id,
    address: row.address,
    city: row.city ?? null,
    clientName: client?.name ?? null,
    note,
    noteTone,
  };
}

export default async function ActionItemsSection() {
  const supabase = await createClient();
  const today = todayPacificISO();
  const tomorrow = addDaysISO(today, 1);
  const pendingCutoffIso = new Date(
    Date.now() - 20 * 86400000,
  ).toISOString();

  const [unsignedRes, longPendingRes, tomorrowRes, feesRes] = await Promise.all([
    supabase
      .from("stages")
      .select(
        "id, address, city, stage_date, signature_envelope_id, clients(name)",
      )
      .eq("status", "scheduled")
      .gt("amount", 0)
      .is("signature_completed_at", null)
      .order("stage_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("stages")
      .select(
        "id, address, city, destage_date, listing_pending_notified_at, clients(name)",
      )
      .eq("status", "staged")
      .not("listing_pending_notified_at", "is", null)
      .lte("listing_pending_notified_at", pendingCutoffIso)
      .or(
        "listing_status.ilike.*PENDING*,listing_status.ilike.*CONTINGENT*,listing_status.ilike.*UNDER_CONTRACT*",
      )
      .order("listing_pending_notified_at", { ascending: true }),
    supabase
      .from("stages")
      .select("id, address, city, clients(name)")
      .eq("stage_date", tomorrow)
      .in("status", ["scheduled", "staged"]),
    supabase
      .from("stage_fees")
      .select(
        "id, reasons, amount, reported_at, stage:stages(id, address, city, clients(name))",
      )
      .eq("status", "pending")
      .order("reported_at", { ascending: true }),
  ]);

  const unsigned: Item[] = (unsignedRes.data ?? []).map((s: any) =>
    itemFrom(
      s,
      `${s.stage_date ? `Stages ${formatMDY(s.stage_date)} — ` : ""}${
        s.signature_envelope_id
          ? "agreement sent, NOT signed"
          : "no agreement sent"
      }`,
      "rose",
    ),
  );

  const longPending: Item[] = (longPendingRes.data ?? []).map((s: any) => {
    const days = Math.max(
      0,
      Math.round(
        (Date.now() -
          new Date(String(s.listing_pending_notified_at)).getTime()) /
          86400000,
      ),
    );
    return itemFrom(
      s,
      `Pending ${days} days (since ${formatMDY(
        s.listing_pending_notified_at,
      )})${s.destage_date ? ` — destage ${formatMDY(s.destage_date)}` : ""}`,
      "amber",
    );
  });

  // Tomorrow's stages with zero photos: check the photo table for the
  // candidate ids (small set — tomorrow's stages only).
  let noPictures: Item[] = [];
  const tomorrowRows = (tomorrowRes.data ?? []) as any[];
  if (tomorrowRows.length > 0) {
    const { data: photoRows } = await supabase
      .from("stage_photos")
      .select("stage_id")
      .in(
        "stage_id",
        tomorrowRows.map((s) => s.id),
      );
    const withPhotos = new Set((photoRows ?? []).map((p: any) => p.stage_id));
    noPictures = tomorrowRows
      .filter((s) => !withPhotos.has(s.id))
      .map((s) => itemFrom(s, "Stages TOMORROW — no pictures uploaded", "rose"));
  }

  // Arrival-issue fee invoices waiting for an admin to approve the send.
  const pendingFees: Item[] = (feesRes.data ?? [])
    .map((f: any) => {
      const stage = Array.isArray(f.stage) ? f.stage[0] : f.stage;
      if (!stage) return null;
      const amount = Number(f.amount ?? 0);
      const labels = arrivalFeeLabels(
        Array.isArray(f.reasons) ? f.reasons : [],
      ).join(", ");
      return itemFrom(
        stage,
        `$${amount.toFixed(0)} fee — ${labels} — reported ${formatMDY(
          new Date(f.reported_at),
        )}`,
        "amber",
      );
    })
    .filter((x): x is Item => x != null);

  const total =
    unsigned.length + longPending.length + noPictures.length + pendingFees.length;
  if (total === 0) return null;

  const groups: Array<{
    title: string;
    icon: React.ReactNode;
    items: Item[];
  }> = [
    {
      title: "Scheduled without a signed agreement",
      icon: <FileSignature size={13} />,
      items: unsigned,
    },
    {
      title: "Pending 20+ days — plan the destage",
      icon: <Clock size={13} />,
      items: longPending,
    },
    {
      title: "Staging tomorrow with no pictures",
      icon: <Camera size={13} />,
      items: noPictures,
    },
    {
      title: "Extra-fee invoices awaiting approval",
      icon: <Receipt size={13} />,
      items: pendingFees,
    },
  ];

  return (
    <CollapsibleSection
      id="action-items"
      title="Action items"
      defaultOpen
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle
            size={11}
            className="text-amber-600 dark:text-amber-400"
          />
          {total} item{total === 1 ? "" : "s"} need{total === 1 ? "s" : ""}{" "}
          attention
        </span>
      }
    >
      <div className="space-y-4">
        {groups
          .filter((g) => g.items.length > 0)
          .map((g) => (
            <div key={g.title} className="space-y-2">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                {g.icon}
                {g.title}
                <span className="text-slate-400 dark:text-slate-500 normal-case tracking-normal">
                  · {g.items.length}
                </span>
              </div>
              <div className="space-y-2">
                {g.items.map((it) => (
                  <Link
                    key={`${g.title}-${it.id}`}
                    href={`/stages/${it.id}`}
                    className="block rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/40 p-3 shadow-sm transition"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {it.address}
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                          {[it.city, it.clientName].filter(Boolean).join(" · ") ||
                            "—"}
                        </div>
                      </div>
                    </div>
                    <div
                      className={`mt-1.5 text-[11px] font-medium tabular-nums ${
                        it.noteTone === "rose"
                          ? "text-rose-700 dark:text-rose-400"
                          : "text-amber-700 dark:text-amber-400"
                      }`}
                    >
                      {it.note}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
      </div>
    </CollapsibleSection>
  );
}
