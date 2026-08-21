import Link from "next/link";
import BackLink from "@/components/BackLink";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { updateClientAction, deleteClientAction } from "../actions";
import PortalInviteButton from "@/components/PortalInviteButton";
import ClientInfoForm from "@/components/ClientInfoForm";
import ClientStagesCards from "@/components/ClientStagesCards";
import { invoiceNumberFor } from "@/lib/invoice-pdf";
import { requireTeamMember } from "@/lib/permissions";
import { formatMDY } from "@/lib/time";

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {

  await requireTeamMember();
  const { id } = await params;
  const { from } = await searchParams;
  // Honor a "came from a stage" back-target so ← returns to the stage
  // the user clicked through from (predictable static href, same
  // philosophy as BackLink — no history.back()). Strictly validated to
  // an internal stage path so the param can't send anyone off-site.
  const backToStage =
    typeof from === "string" && /^\/stages\/[A-Za-z0-9-]+$/.test(from)
      ? from
      : null;
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
  const { data: client } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (!client) notFound();

  const { data: stages } = await supabase
    .from("stages")
    .select(
      "id, address, status, stage_date, destage_date, amount, paid_at, payment_method, invoice_generated_at",
    )
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  // The invoice number is derived from the stage id + the date the
  // invoice was generated (INV-YYMMDD-XXXXXX) — same string that's on
  // the PDF. Only present once an invoice actually exists.
  const stageCards = (stages ?? []).map((s: any) => ({
    ...s,
    invoice_number: s.invoice_generated_at
      ? invoiceNumberFor(s.id, String(s.invoice_generated_at).slice(0, 10))
      : null,
  }));

  // 30-day extensions across this client's stages — same data the
  // client sees in their portal (date, amount, paid) plus the internal
  // invoice-PDF link. Bounded per-client, so no pagination needed.
  const stageIds = (stages ?? []).map((s: any) => s.id);
  const { data: extRows } =
    stageIds.length > 0
      ? await supabase
          .from("stage_extensions")
          .select("id, stage_id, extension_date, amount, paid_at, pdf_url")
          .in("stage_id", stageIds)
          .order("extension_date", { ascending: false })
      : { data: [] as any[] };
  const addressByStage = new Map(
    (stages ?? []).map((s: any) => [s.id, s.address as string]),
  );
  const extensions = (extRows ?? []).map((x: any) => ({
    id: x.id as string,
    stageId: x.stage_id as string,
    address: addressByStage.get(x.stage_id) ?? "—",
    extensionDate: (x.extension_date as string | null) ?? null,
    amount: Number(x.amount ?? 0),
    paidAt: (x.paid_at as string | null) ?? null,
    pdfUrl: (x.pdf_url as string | null) ?? null,
  }));
  const extBilled = extensions.reduce((s, x) => s + x.amount, 0);
  const extUnpaid = extensions
    .filter((x) => !x.paidAt)
    .reduce((s, x) => s + x.amount, 0);

  const update = updateClientAction.bind(null, id);
  const del = deleteClientAction.bind(null, id);

  return (
    <div className="space-y-8">
      <div>
        <BackLink
          fallback={backToStage ?? "/clients"}
          className="text-sm text-slate-700 dark:text-slate-300 hover:underline"
        >
          ← Back
        </BackLink>
        <h1 className="text-2xl font-semibold mt-1">{client.name}</h1>
      </div>

      <ClientInfoForm
        updateAction={update}
        deleteAction={del}
        isAdmin={isAdmin}
        stageCount={stages?.length ?? 0}
        defaults={{
          name: client.name,
          email: client.email ?? "",
          phone: client.phone ?? "",
          address: client.address ?? "",
          notes: client.notes ?? "",
          paymentReminders: client.payment_reminders !== false,
        }}
      />

      {/* Portal access — send the client a one-click sign-in link to
          the client portal. Admin-only (the action requires admin). */}
      {isAdmin && (
        <div className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-2">
          <div>
            <h2 className="text-base font-semibold">Client portal</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Emails a magic-link sign-in to the client. They can view their
              stages, dates, and payment status — no photos or team info.
            </p>
          </div>
          <PortalInviteButton
            clientId={client.id}
            hasEmail={!!(client.email && client.email.trim())}
          />
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Stages</h2>
          <Link
            href={`/stages/new?client=${client.id}`}
            className="text-sm bg-slate-900 text-white rounded px-3 py-1.5"
          >
            + New stage
          </Link>
        </div>
        <ClientStagesCards stages={stageCards as any} />
      </section>

      {/* 30-day extensions across this client's stages. Clients see
          the same info (minus the PDF link) in their portal. */}
      <section>
        <div className="flex items-center justify-between mb-3 gap-3">
          <h2 className="text-lg font-semibold">Extensions</h2>
          {extensions.length > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              ${extBilled.toFixed(2)} billed
              {extUnpaid > 0 && ` · $${extUnpaid.toFixed(2)} unpaid`}
            </span>
          )}
        </div>
        {extensions.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic px-1">
            No extensions yet.
          </p>
        ) : (
          <div className="bg-white dark:bg-slate-900 border rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
            {extensions.map((x) => (
              <div
                key={x.id}
                className="p-3 sm:p-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5"
              >
                <div className="min-w-0">
                  <Link
                    href={`/stages/${x.stageId}`}
                    className="font-medium text-sm text-slate-900 dark:text-slate-100 hover:text-brand"
                  >
                    {x.address}
                  </Link>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Extended through{" "}
                    <span className="text-slate-700 dark:text-slate-300">
                      {formatMDY(x.extensionDate)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-sm font-medium tabular-nums">
                    ${x.amount.toFixed(2)}
                  </span>
                  {x.paidAt ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50">
                      <CheckCircle2 size={11} /> Paid
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50">
                      Unpaid
                    </span>
                  )}
                  {x.pdfUrl && (
                    <a
                      href={x.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-brand hover:text-brand-hover underline underline-offset-2"
                    >
                      Invoice PDF
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
