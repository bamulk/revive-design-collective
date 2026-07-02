import Link from "next/link";
import { notFound } from "next/navigation";
import { Droplet, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireTeamMember } from "@/lib/permissions";
import { formatMDY, todayPacificISO } from "@/lib/time";
import { trailerServiceDue } from "@/lib/maintenance";
import {
  updateMileageAction,
  updateVehicleAction,
  logServiceAction,
  deleteServiceLogAction,
  reportIssueAction,
  resolveIssueAction,
  reopenIssueAction,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireTeamMember();
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .maybeSingle();
  const isAdmin = me?.role === "admin";

  const { data: vehicle } = await supabase
    .from("vehicles")
    .select("*")
    .eq("id", id)
    .single();
  if (!vehicle) notFound();

  const [{ data: logs }, { data: issues }] = await Promise.all([
    supabase
      .from("vehicle_service_logs")
      .select("*")
      .eq("vehicle_id", id)
      .order("performed_on", { ascending: false }),
    supabase
      .from("vehicle_issues")
      .select("*")
      .eq("vehicle_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const openIssues = (issues ?? []).filter((i: any) => i.status === "open");
  const resolvedIssues = (issues ?? []).filter(
    (i: any) => i.status === "resolved",
  );

  const today = todayPacificISO();
  const isTrailer = vehicle.kind === "trailer";
  const lastServiceISO =
    ((logs ?? []) as any[]).find((l) => l.kind === "service")?.performed_on ??
    null;
  const due = isTrailer ? trailerServiceDue(lastServiceISO, today) : null;
  const input =
    "border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-base bg-white dark:bg-slate-900";

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/maintenance"
          className="text-sm text-slate-700 dark:text-slate-300 hover:underline"
        >
          ← Maintenance
        </Link>
        <div className="flex items-center gap-2 mt-1">
          <h1 className="text-2xl font-semibold">{vehicle.name}</h1>
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 capitalize">
            {vehicle.kind}
          </span>
        </div>
      </div>

      {/* Odometer — vehicles only (trailers have no engine/odometer);
          editable by any team member */}
      {!isTrailer && (
        <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3">
          <h2 className="font-medium">Odometer</h2>
          <form
            data-no-loader
            action={updateMileageAction.bind(null, vehicle.id)}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="text-sm">
              <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Current mileage
              </span>
              <input
                name="current_mileage"
                type="number"
                inputMode="numeric"
                defaultValue={vehicle.current_mileage ?? ""}
                placeholder="e.g. 84230"
                className={`${input} w-40`}
              />
            </label>
            <button className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm">
              Update
            </button>
          </form>
        </section>
      )}

      {/* Trailer service-due banner (every 6 months) */}
      {isTrailer && (
        <section
          className={`border rounded-xl p-4 text-sm flex items-center justify-between gap-3 ${
            due?.due
              ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50"
              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
          }`}
        >
          <span
            className={
              due?.due
                ? "font-medium text-amber-800 dark:text-amber-300"
                : "text-slate-600 dark:text-slate-400"
            }
          >
            {due?.due
              ? "Service due (every 6 months)"
              : "Service up to date (every 6 months)"}
          </span>
          <span className="text-slate-500 dark:text-slate-400 shrink-0">
            {due?.nextDueISO
              ? `Next due ${formatMDY(due.nextDueISO)}`
              : "Never serviced"}
          </span>
        </section>
      )}

      {/* Service log */}
      <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Service log</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {isTrailer ? "Services" : "Oil changes & services"}
          </span>
        </div>

        <form
          data-no-loader
          action={logServiceAction.bind(null, vehicle.id)}
          className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end bg-slate-50 dark:bg-slate-800/40 rounded-lg p-3"
        >
          {isTrailer ? (
            // Trailers: services only, no oil changes.
            <input type="hidden" name="kind" value="service" />
          ) : (
            <label className="text-sm col-span-2 sm:col-span-1">
              <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Type
              </span>
              <select name="kind" defaultValue="oil_change" className={`${input} w-full`}>
                <option value="oil_change">Oil change</option>
                <option value="service">Service</option>
              </select>
            </label>
          )}
          <label className="text-sm">
            <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
              Date
            </span>
            <input name="performed_on" type="date" defaultValue={today} className={`${input} w-full`} />
          </label>
          {!isTrailer && (
            <label className="text-sm">
              <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Mileage
              </span>
              <input name="mileage" type="number" inputMode="numeric" placeholder="mi" className={`${input} w-full`} />
            </label>
          )}
          <label className="text-sm">
            <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
              Cost
            </span>
            <input name="cost" type="number" step="0.01" inputMode="decimal" placeholder="$" className={`${input} w-full`} />
          </label>
          <label className="text-sm col-span-2 sm:col-span-5">
            <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
              Notes
            </span>
            <input name="notes" placeholder="Optional notes" className={`${input} w-full`} />
          </label>
          <div className="col-span-2 sm:col-span-5">
            <button className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm">
              Log service
            </button>
          </div>
        </form>

        {logs && logs.length > 0 ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(logs as any[]).map((l) => (
              <li key={l.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {l.kind === "oil_change" ? (
                    <Droplet size={14} className="text-amber-600 shrink-0" />
                  ) : (
                    <Wrench size={14} className="text-slate-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {l.kind === "oil_change" ? "Oil change" : "Service"}
                      <span className="text-slate-500 dark:text-slate-400 font-normal">
                        {" "}
                        · {formatMDY(l.performed_on)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      {[
                        l.mileage != null ? `${l.mileage.toLocaleString()} mi` : null,
                        l.cost != null ? `$${Number(l.cost).toFixed(2)}` : null,
                        l.notes || null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </div>
                </div>
                {isAdmin && (
                  <form data-no-loader action={deleteServiceLogAction.bind(null, l.id, vehicle.id)}>
                    <button className="text-xs text-slate-400 hover:text-rose-600">Delete</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No service logged yet.</p>
        )}
      </section>

      {/* Issues */}
      <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
        <h2 className="font-medium">Issue requests</h2>

        <form
          data-no-loader
          action={reportIssueAction.bind(null, vehicle.id)}
          className="space-y-2"
        >
          <textarea
            name="description"
            required
            rows={2}
            placeholder="Describe the issue (e.g. brake light out, slow leak in left rear tire)…"
            className={`${input} w-full`}
          />
          <button className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm">
            Report issue
          </button>
        </form>

        {openIssues.length > 0 && (
          <ul className="space-y-2">
            {(openIssues as any[]).map((i) => (
              <li
                key={i.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-slate-900 dark:text-slate-100">{i.description}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Reported {formatMDY(i.reported_at)}
                  </p>
                </div>
                <form data-no-loader action={resolveIssueAction.bind(null, i.id, vehicle.id)}>
                  <button className="text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-2.5 py-1 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0">
                    Resolve
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {resolvedIssues.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Resolved
            </p>
            <ul className="space-y-1.5">
              {(resolvedIssues as any[]).map((i) => (
                <li
                  key={i.id}
                  className="flex items-start justify-between gap-3 text-sm text-slate-500 dark:text-slate-400"
                >
                  <span className="line-through min-w-0">{i.description}</span>
                  <form data-no-loader action={reopenIssueAction.bind(null, i.id, vehicle.id)}>
                    <button className="text-xs hover:text-slate-700 dark:hover:text-slate-200 shrink-0">
                      Reopen
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}

        {openIssues.length === 0 && resolvedIssues.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No issues reported.</p>
        )}
      </section>

      {/* Admin: rename / notes */}
      {isAdmin && (
        <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3">
          <h2 className="font-medium">Details</h2>
          <form
            data-no-loader
            action={updateVehicleAction.bind(null, vehicle.id)}
            className="space-y-2"
          >
            <label className="block text-sm">
              <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Name
              </span>
              <input name="name" required defaultValue={vehicle.name} className={`${input} w-full`} />
            </label>
            <label className="block text-sm">
              <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Notes
              </span>
              <textarea name="notes" rows={2} defaultValue={vehicle.notes ?? ""} className={`${input} w-full`} />
            </label>
            <button className="bg-slate-900 text-white rounded-lg px-4 py-2 text-sm">
              Save
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
