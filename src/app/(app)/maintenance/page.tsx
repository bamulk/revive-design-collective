import Link from "next/link";
import { Truck, Droplet, Wrench, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireTeamMember } from "@/lib/permissions";
import { formatMDY, todayPacificISO } from "@/lib/time";
import { trailerServiceDue } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

type Vehicle = {
  id: string;
  name: string;
  kind: "vehicle" | "trailer";
  current_mileage: number | null;
  position: number;
};

export default async function MaintenancePage() {
  await requireTeamMember();
  const supabase = await createClient();

  const [{ data: vehicles }, { data: logs }, { data: openIssues }] =
    await Promise.all([
      supabase
        .from("vehicles")
        .select("id, name, kind, current_mileage, position")
        .eq("active", true)
        .order("position", { ascending: true }),
      supabase
        .from("vehicle_service_logs")
        .select("vehicle_id, kind, performed_on, mileage")
        .order("performed_on", { ascending: false }),
      supabase.from("vehicle_issues").select("vehicle_id").eq("status", "open"),
    ]);

  // Latest oil change / service per vehicle (logs are date-desc).
  const lastOil = new Map<string, { performed_on: string; mileage: number | null }>();
  const lastService = new Map<string, { performed_on: string; mileage: number | null }>();
  for (const l of (logs ?? []) as any[]) {
    const map = l.kind === "oil_change" ? lastOil : lastService;
    if (!map.has(l.vehicle_id)) {
      map.set(l.vehicle_id, { performed_on: l.performed_on, mileage: l.mileage });
    }
  }
  const openCount = new Map<string, number>();
  for (const i of (openIssues ?? []) as any[]) {
    openCount.set(i.vehicle_id, (openCount.get(i.vehicle_id) ?? 0) + 1);
  }

  const all = (vehicles ?? []) as Vehicle[];
  const groups: { label: string; items: Vehicle[] }[] = [
    { label: "Vehicles", items: all.filter((v) => v.kind === "vehicle") },
    { label: "Trailers", items: all.filter((v) => v.kind === "trailer") },
  ];

  const today = todayPacificISO();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Maintenance</h1>
        <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
          Mileage, oil changes, services, and issue requests for the fleet.
        </p>
      </div>

      {groups.map((group) => (
        <section key={group.label} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {group.label}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.items.map((v) => {
              const oil = lastOil.get(v.id);
              const svc = lastService.get(v.id);
              const open = openCount.get(v.id) ?? 0;
              const isTrailer = v.kind === "trailer";
              const due = isTrailer
                ? trailerServiceDue(svc?.performed_on ?? null, today)
                : null;
              return (
                <Link
                  key={v.id}
                  href={`/maintenance/${v.id}`}
                  className="block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-4 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Truck size={16} className="text-slate-500 shrink-0" />
                      <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {v.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {due?.due && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50">
                          Service due
                        </span>
                      )}
                      {open > 0 && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50">
                          <AlertTriangle size={10} /> {open}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                    {isTrailer ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5">
                            <Wrench size={11} /> Last service
                          </span>
                          <span className="text-slate-800 dark:text-slate-200">
                            {svc ? formatMDY(svc.performed_on) : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Next service due</span>
                          <span
                            className={
                              due?.due
                                ? "font-medium text-amber-700 dark:text-amber-400"
                                : "text-slate-800 dark:text-slate-200"
                            }
                          >
                            {due?.nextDueISO ? formatMDY(due.nextDueISO) : "Now"}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <span>Odometer</span>
                          <span className="tabular-nums font-medium text-slate-800 dark:text-slate-200">
                            {v.current_mileage != null
                              ? `${v.current_mileage.toLocaleString()} mi`
                              : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5">
                            <Droplet size={11} /> Oil change
                          </span>
                          <span className="text-slate-800 dark:text-slate-200">
                            {oil
                              ? `${formatMDY(oil.performed_on)}${
                                  oil.mileage != null
                                    ? ` · ${oil.mileage.toLocaleString()} mi`
                                    : ""
                                }`
                              : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5">
                            <Wrench size={11} /> Service
                          </span>
                          <span className="text-slate-800 dark:text-slate-200">
                            {svc ? formatMDY(svc.performed_on) : "—"}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
