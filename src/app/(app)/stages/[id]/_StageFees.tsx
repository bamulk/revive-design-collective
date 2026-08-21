import { createClient } from "@/lib/supabase/server";
import ArrivalIssuesCard, { type FeeRow } from "@/components/ArrivalIssuesCard";

/**
 * Loads this stage's arrival-issue fee reports and renders the card.
 * Streams in under Suspense so the stage page shell isn't held up.
 */
export default async function StageFees({
  stageId,
  isAdmin,
  clientEmail,
}: {
  stageId: string;
  isAdmin: boolean;
  clientEmail: string | null;
}) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stage_fees")
    .select(
      "id, reasons, note, amount, status, reported_by_name, reported_at, invoice_number, pdf_url, sent_at, paid_at",
    )
    .eq("stage_id", stageId)
    .order("reported_at", { ascending: false });

  const fees: FeeRow[] = (data ?? []).map((f: any) => ({
    id: f.id,
    reasons: Array.isArray(f.reasons) ? f.reasons : [],
    note: f.note ?? null,
    amount: Number(f.amount ?? 0),
    status: f.status,
    reported_by_name: f.reported_by_name ?? null,
    reported_at: f.reported_at,
    invoice_number: f.invoice_number ?? null,
    pdf_url: f.pdf_url ?? null,
    sent_at: f.sent_at ?? null,
    paid_at: f.paid_at ?? null,
  }));

  return (
    <ArrivalIssuesCard
      stageId={stageId}
      isAdmin={isAdmin}
      clientEmail={clientEmail}
      fees={fees}
    />
  );
}
