import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PortalStagesList, {
  type PortalCard,
} from "@/components/PortalStagesList";

export const dynamic = "force-dynamic";

/**
 * Client portal home. Lists every stage tied to the signed-in client
 * with status, dates, payment status, and any extensions.
 *
 * RLS-scoped — the user-bound Supabase client only returns stages
 * where `client_id` matches `current_client_id()` (see migration 033).
 * The query is also kept to ONLY the fields a client may see — no
 * photos, notes, team, lockbox, etc. Cards + the paid/unpaid filter
 * render in the PortalStagesList client component.
 */

type Status = "scheduled" | "staged" | "destaged" | "completed" | "cancelled";

export default async function PortalHomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  const [{ data: stages }, { data: extensions }, { data: payments }] =
    await Promise.all([
      supabase
        .from("stages")
        .select(
          "id, address, city, status, stage_date, destage_date, amount, paid_at, invoice_pdf_url",
        )
        .neq("status", "estimate")
        .order("stage_date", { ascending: false, nullsFirst: false }),
      supabase
        .from("stage_extensions")
        .select(
          "id, stage_id, extension_date, amount, paid_at, pdf_url, created_at",
        )
        .order("extension_date", { ascending: false }),
      supabase
        .from("stage_payments")
        .select("id, stage_id, amount, paid_at, method")
        .order("paid_at", { ascending: false }),
    ]);

  const list = (stages ?? []) as Array<{
    id: string;
    address: string;
    city: string | null;
    status: Status;
    stage_date: string | null;
    destage_date: string | null;
    amount: number | null;
    paid_at: string | null;
    invoice_pdf_url: string | null;
  }>;

  const extsByStage = new Map<string, PortalCard["exts"]>();
  for (const e of (extensions ?? []) as any[]) {
    const arr = extsByStage.get(e.stage_id) ?? [];
    arr.push({
      id: e.id,
      extension_date: e.extension_date,
      amount: e.amount,
      paid_at: e.paid_at,
      pdf_url: e.pdf_url ?? null,
    });
    extsByStage.set(e.stage_id, arr);
  }

  const paymentsByStage = new Map<string, PortalCard["payments"]>();
  for (const p of (payments ?? []) as any[]) {
    const arr = paymentsByStage.get(p.stage_id) ?? [];
    arr.push({
      id: p.id,
      amount: p.amount,
      paid_at: p.paid_at,
      method: p.method,
    });
    paymentsByStage.set(p.stage_id, arr);
  }

  const cards: PortalCard[] = list.map((s) => {
    const stagePayments = paymentsByStage.get(s.id) ?? [];
    const stageAmount = s.amount != null ? Number(s.amount) : 0;
    const paidSoFar = stagePayments.reduce(
      (sum, p) => sum + Number(p.amount ?? 0),
      0,
    );
    const outstanding = Math.max(stageAmount - paidSoFar, 0);
    const paymentState: PortalCard["paymentState"] =
      stageAmount === 0
        ? "unpaid"
        : outstanding <= 0
          ? "paid"
          : paidSoFar > 0
            ? "partial"
            : "unpaid";
    // A stage marked paid (paid_at) with no payment-ledger rows still
    // reads as paid.
    const finalState =
      paymentState !== "paid" && s.paid_at && stagePayments.length === 0
        ? "paid"
        : paymentState;
    return {
      ...s,
      paidSoFar,
      outstanding,
      paymentState: finalState,
      payments: stagePayments,
      exts: extsByStage.get(s.id) ?? [],
    };
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          My stages
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {list.length === 0
            ? "Nothing yet — your scheduled stages will appear here."
            : `${list.length} stage${list.length === 1 ? "" : "s"} on file`}
        </p>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-600 dark:text-slate-400">
          No stages on file yet. If you&rsquo;re expecting to see one, please
          contact Revive Design Collective.
        </div>
      ) : (
        <PortalStagesList cards={cards} />
      )}
    </div>
  );
}
