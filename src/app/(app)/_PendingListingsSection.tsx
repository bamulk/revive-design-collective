import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import CollapsibleSection from "@/components/CollapsibleSection";
import { formatMDY } from "@/lib/time";

/**
 * "Pending listings" panel on the dashboard. Surfaces every still-
 * staged job whose Zillow status has flipped to Pending / Contingent /
 * Under Contract.
 *
 * Wraps the shared CollapsibleSection so it visually matches the
 * other dashboard sections (Outstanding invoices, Currently staged).
 * Hidden entirely when nothing's pending. When the same address has
 * been staged more than once, only the most recent staging shows.
 */
export default async function PendingListingsSection() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("stages")
    .select(
      "id, address, city, stage_date, destage_date, listing_status, listing_status_checked_at, zillow_url, clients(name)",
    )
    .eq("status", "staged")
    .or(
      "listing_status.ilike.*PENDING*,listing_status.ilike.*CONTINGENT*,listing_status.ilike.*UNDER_CONTRACT*",
    )
    .order("listing_status_checked_at", {
      ascending: false,
      nullsFirst: false,
    });

  // Dedupe by normalized address: keep the row with the most recent
  // stage_date so a property re-staged later doesn't show twice.
  const byAddress = new Map<string, any>();
  for (const r of (rows ?? []) as any[]) {
    const key = String(r.address ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const prev = byAddress.get(key);
    if (!prev) {
      byAddress.set(key, r);
      continue;
    }
    const a = prev.stage_date ?? "";
    const b = r.stage_date ?? "";
    if (b > a) byAddress.set(key, r);
  }
  const list = Array.from(byAddress.values());
  if (list.length === 0) return null;

  return (
    <CollapsibleSection
      id="pending-listings"
      title="Pending listings"
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle
            size={11}
            className="text-rose-600 dark:text-rose-400"
          />
          {list.length} listing{list.length === 1 ? "" : "s"} under contract on
          Zillow — destage soon
        </span>
      }
      defaultOpen
    >
      <div className="space-y-2">
        {list.map((s) => {
          const clean = String(s.listing_status ?? "")
            .replace(/_/g, " ")
            .toLowerCase()
            .replace(/\b\w/g, (c: string) => c.toUpperCase());
          return (
            <Link
              key={s.id}
              href={`/stages/${s.id}`}
              className="block rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30 hover:bg-rose-50 dark:hover:bg-rose-950/50 p-3 shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {s.address}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                    {[s.city, s.clients?.name].filter(Boolean).join(" · ") ||
                      "—"}
                  </div>
                </div>
                <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset bg-rose-600 text-white ring-rose-700">
                  {clean}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                <span>Staged {formatMDY(s.stage_date)}</span>
                {s.destage_date && (
                  <span>Destage {formatMDY(s.destage_date)}</span>
                )}
                {s.listing_status_checked_at && (
                  <span title="Last Zillow check">
                    Checked {formatMDY(s.listing_status_checked_at)}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
