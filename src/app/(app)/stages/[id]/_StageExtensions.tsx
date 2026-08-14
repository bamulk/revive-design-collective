import { createClient } from "@/lib/supabase/server";
import ExtensionSection from "@/components/ExtensionSection";

/**
 * Async server component that loads the per-stage extension rows and
 * renders the admin ExtensionSection. Wrapped in Suspense in the
 * parent so it streams in independently — the stage page shell isn't
 * held up waiting for it.
 */
export default async function StageExtensions({
  stageId,
  destageDate,
  stageAmount,
  clientEmail,
}: {
  stageId: string;
  destageDate: string | null;
  stageAmount: number;
  /** For the per-row Send/Resend invoice button. */
  clientEmail: string | null;
}) {
  const supabase = await createClient();
  const { data: extensions } = await supabase
    .from("stage_extensions")
    .select(
      "id, extension_date, amount, paid_at, pdf_url, pdf_sent_at, source, created_at, accepted_at, accepted_by",
    )
    .eq("stage_id", stageId)
    .order("created_at", { ascending: false });

  return (
    <ExtensionSection
      stageId={stageId}
      destageDate={destageDate}
      stageAmount={stageAmount}
      clientEmail={clientEmail}
      extensions={(extensions ?? []).map((e: any) => ({
        id: e.id,
        extension_date: e.extension_date ?? null,
        amount: Number(e.amount ?? 0),
        paid_at: e.paid_at ?? null,
        pdf_url: e.pdf_url ?? null,
        pdf_sent_at: e.pdf_sent_at ?? null,
        source: (e.source as "manual" | "auto") ?? "manual",
        created_at: e.created_at,
        accepted_at: e.accepted_at ?? null,
        accepted_by: e.accepted_by ?? null,
      }))}
    />
  );
}

/** Skeleton card mirroring ExtensionSection's open layout. */
export function StageExtensionsFallback() {
  return (
    <div className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-3">
      <div className="h-5 w-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
      <div className="h-12 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
      <div className="h-12 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
    </div>
  );
}
