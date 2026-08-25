import Link from "next/link";
import { CalendarDays, Home as HomeIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, LinkButton } from "@/components/ui";
import MapView, { type MapStage } from "./MapView";
import { getWarehouseCoords } from "@/lib/distance";
import BulkGeocodeButton from "./BulkGeocodeButton";

export const dynamic = "force-dynamic";

/**
 * Map view of every active stage with cached coords. Color-coded by
 * status (blue / orange / emerald) using the same palette as the rest
 * of the app. Stages without lat/lng don't appear — admins can fire
 * the bulk geocoder from the button at the top.
 */
export default async function StagesMapPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).single()
    : { data: null };
  const isAdmin = me?.role === "admin";

  // Pull every active stage that has been geocoded. Estimates,
  // cancelled, and completed rows are excluded — completed jobs
  // historically clutter the view and aren't actionable.
  const { data: stages } = await supabase
    .from("stages")
    .select(
      "id, address, city, status, stage_date, destage_date, lat, lng, clients(name)",
    )
    .neq("status", "estimate")
    .neq("status", "cancelled")
    .neq("status", "completed")
    .not("lat", "is", null)
    .not("lng", "is", null);

  // Totals so the user knows how many addresses still need geocoding.
  // Matches the same status filter as above so the count is honest.
  const { count: activeTotal } = await supabase
    .from("stages")
    .select("id", { count: "exact", head: true })
    .neq("status", "estimate")
    .neq("status", "cancelled")
    .neq("status", "completed");

  const cards: MapStage[] = (stages ?? []).map((s: any) => ({
    id: s.id,
    address: s.address,
    city: s.city ?? null,
    status: s.status,
    stageDate: s.stage_date ?? null,
    destageDate: s.destage_date ?? null,
    clientName: s.clients?.name ?? null,
    lat: Number(s.lat),
    lng: Number(s.lng),
  }));

  const warehouse = await getWarehouseCoords();
  const pinned = cards.length;
  const missing = Math.max(0, (activeTotal ?? 0) - pinned);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Map"
        subtitle={
          missing > 0
            ? `${pinned} of ${activeTotal} addresses pinned · ${missing} need geocoding`
            : `${pinned} stage${pinned === 1 ? "" : "s"} on the map`
        }
        actions={
          <>
            <LinkButton href="/stages/groups" variant="secondary">
              <HomeIcon size={14} /> Stages
            </LinkButton>
            <LinkButton href="/stages/calendar" variant="secondary">
              <CalendarDays size={14} /> Calendar
            </LinkButton>
            {isAdmin && missing > 0 && <BulkGeocodeButton remaining={missing} />}
          </>
        }
      />

      <MapView stages={cards} warehouse={warehouse} />

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400 px-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-blue-500 ring-2 ring-white shadow" />
          Upcoming
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-orange-500 ring-2 ring-white shadow" />
          Staged
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white shadow" />
          Destages
        </span>
        {warehouse && (
          <span className="inline-flex items-center gap-1.5 ml-2">
            <span className="text-base leading-none">🏠</span>
            Warehouse
          </span>
        )}
      </div>
    </div>
  );
}
