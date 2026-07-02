import Link from "next/link";
import { Camera } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import CollapsibleSection from "@/components/CollapsibleSection";
import { formatMDY } from "@/lib/time";

/**
 * "Need Pictures" panel on the dashboard. Lists every upcoming
 * (scheduled) stage that doesn't have any photos yet, so the team can
 * see at a glance which jobs still need a photo shoot before they're
 * staged.
 *
 * A stage's first photo path is cached on the row by trigger
 * (migration 028), so "no photos" is simply
 * `first_photo_storage_path is null` — no separate stage_photos scan.
 *
 * Wraps the shared CollapsibleSection so it matches the other
 * dashboard panels (Pending listings, Outstanding invoices). Visible
 * to everyone; hides itself when every upcoming stage already has a
 * photo so the dashboard stays clean.
 */
export default async function NeedPicturesSection() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("stages")
    .select("id, address, city, stage_date, clients(name)")
    .eq("status", "scheduled")
    .is("first_photo_storage_path", null)
    // Soonest stage date first; undated jobs sink to the bottom.
    .order("stage_date", { ascending: true, nullsFirst: false });

  const list = (rows ?? []) as any[];
  if (list.length === 0) return null;

  return (
    <CollapsibleSection
      id="need-pictures"
      title="Need Pictures"
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <Camera size={11} className="text-amber-600 dark:text-amber-400" />
          {list.length} upcoming stage{list.length === 1 ? "" : "s"} without
          photos yet
        </span>
      }
      defaultOpen
    >
      <div className="space-y-2">
        {list.map((s) => (
          <Link
            key={s.id}
            href={`/stages/${s.id}`}
            className="block rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 hover:bg-amber-50 dark:hover:bg-amber-950/50 p-3 shadow-sm transition"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                  {s.address}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                  {[s.city, s.clients?.name].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset bg-amber-500 text-white ring-amber-600">
                <Camera size={11} /> No photos
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
              <span>Stage {s.stage_date ? formatMDY(s.stage_date) : "TBD"}</span>
            </div>
          </Link>
        ))}
      </div>
    </CollapsibleSection>
  );
}
