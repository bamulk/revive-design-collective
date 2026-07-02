import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import PackagePicker from "@/components/PackagePicker";
import EstimateShareLink from "@/components/EstimateShareLink";
import { parseLineItems, type SelectedAddOn } from "@/lib/pricing";
import { requireEstimateAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function EstimateDetailPage({
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
      "id, address, amount, package_key, add_ons, discount, line_items, stage_date, destage_date, notes, status, estimate_token, estimate_sent_at, estimate_accepted_at, estimate_declined_at, clients(id, name, email, phone)"
    )
    .eq("id", id)
    .single();
  if (!stage) notFound();
  const customLineItems = parseLineItems(stage.line_items);

  // Build the public accept URL from the request headers so it works
  // in any environment (vercel preview, production, localhost).
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "localhost:3000";
  const acceptUrl = stage.estimate_token
    ? `${proto}://${host}/e/${stage.estimate_token}`
    : null;

  const client: any = Array.isArray(stage.clients)
    ? stage.clients[0]
    : stage.clients;

  const isPending = stage.status === "estimate";
  const isAccepted = !!stage.estimate_accepted_at;
  const isDeclined = !!stage.estimate_declined_at;

  return (
    <div className="space-y-6 max-w-2xl">
      <Link
        href="/estimates"
        className="text-sm text-slate-700 dark:text-slate-300 hover:underline"
      >
        ← Estimates
      </Link>
      <PageHeader
        title={stage.address}
        subtitle={`Estimate for ${client?.name ?? "—"}${
          client?.email ? ` · ${client.email}` : ""
        }`}
      />

      {/* Status badge / state callout */}
      {isAccepted && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
          ✅ Accepted on{" "}
          {new Date(stage.estimate_accepted_at!).toLocaleString()}. The
          stage has been added to your board —{" "}
          <Link href={`/stages/${stage.id}`} className="underline">
            open it
          </Link>
          .
        </div>
      )}
      {isDeclined && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 text-sm text-rose-800">
          ❌ Declined on{" "}
          {new Date(stage.estimate_declined_at!).toLocaleString()}.
        </div>
      )}

      {/* Shareable link */}
      {isPending && acceptUrl && (
        <EstimateShareLink
          stageId={stage.id}
          token={stage.estimate_token!}
          url={acceptUrl}
          clientEmail={client?.email ?? null}
          clientPhone={client?.phone ?? null}
          sentAt={stage.estimate_sent_at ?? null}
        />
      )}

      {/* Read-only package + dates summary */}
      <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-4">
        <PackagePicker
          compact
          defaultPackageKey={stage.package_key ?? null}
          defaultAddOns={(stage.add_ons ?? []) as SelectedAddOn[]}
          defaultDiscount={Number(stage.discount ?? 0)}
        />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Stage date
            </div>
            <div className="text-slate-900 dark:text-slate-100">{stage.stage_date ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Destage date
            </div>
            <div className="text-slate-900 dark:text-slate-100">{stage.destage_date ?? "—"}</div>
          </div>
        </div>
        {customLineItems.length > 0 && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              Custom line items
            </div>
            <ul className="space-y-1.5">
              {customLineItems.map((li, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-slate-800 dark:text-slate-200">
                    {li.description}
                  </span>
                  <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
                    $
                    {li.price.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {stage.notes && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
              Internal notes
            </div>
            <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap text-sm">
              {stage.notes}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
