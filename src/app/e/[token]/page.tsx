import { notFound } from "next/navigation";
import Image from "next/image";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import {
  computePrice,
  ESCROW_FEE,
  PACKAGE_INCLUDES,
  parseLineItems,
  sumLineItems,
  type SelectedAddOn,
} from "@/lib/pricing";
import EstimateAcceptButtons from "@/components/EstimateAcceptButtons";

export const dynamic = "force-dynamic";

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createAdminClient(url, key, { auth: { persistSession: false } });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "TBD";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Public estimate landing page — no auth required. Identified by the
 * estimate_token. Once accepted/declined, the token is wiped server-side
 * so the link stops working.
 */
export default async function EstimateAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = admin();
  const { data: estimate } = await sb
    .from("estimate_public")
    .select("*")
    .eq("estimate_token", token)
    .single();

  if (!estimate) {
    // Could be: never existed, or already accepted/declined.
    return (
      <Shell>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Estimate not available
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This estimate link may have already been used or is no longer
            valid. Please contact us if you have any questions.
          </p>
        </div>
      </Shell>
    );
  }

  const breakdown = computePrice(
    estimate.package_key,
    (estimate.add_ons ?? []) as SelectedAddOn[],
    Number(estimate.discount ?? 0)
  );
  const escrowOn = !!estimate.escrow;
  const travelFee = Number(estimate.travel_fee ?? 0) || 0;
  const customLineItems = parseLineItems(estimate.line_items);
  const lineItemsTotal = sumLineItems(customLineItems);
  const estimateAmount = Number(estimate.amount ?? 0);
  // Recover the custom base staging charge (custom-price mode) by backing
  // escrow + travel + line items out of the saved total.
  const customSubtotal = Math.max(
    0,
    estimateAmount - (escrowOn ? ESCROW_FEE : 0) - travelFee - lineItemsTotal,
  );
  const isCustomPrice = !estimate.package_key && customSubtotal > 0;
  const lineItems = [
    ...(isCustomPrice
      ? [{ label: "Home staging", amount: customSubtotal }]
      : [
          ...(breakdown.package
            ? [{ label: breakdown.package.label, amount: breakdown.package.price }]
            : []),
          ...breakdown.addOns.map((a) => ({
            label: `${a.addOn.label} × ${a.qty}`,
            amount: a.subtotal,
          })),
        ]),
    ...customLineItems.map((li) => ({
      label: li.description,
      amount: li.price,
    })),
  ];
  // Services total shown to the client. Escrow + travel are billed on the
  // final invoice (not surfaced on the estimate), so back them out of the
  // saved amount — this equals the listed items minus any discount.
  const servicesTotal = Math.max(
    0,
    estimateAmount - (escrowOn ? ESCROW_FEE : 0) - travelFee,
  );

  const isAccepted = !!estimate.estimate_accepted_at;
  const isDeclined = !!estimate.estimate_declined_at;
  const settled = isAccepted || isDeclined;

  return (
    <Shell>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 sm:p-8 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Estimate
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                {estimate.address}
              </h1>
              {estimate.client_name && (
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  For {estimate.client_name}
                </p>
              )}
            </div>
            {isAccepted && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200">
                Accepted
              </span>
            )}
            {isDeclined && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ring-1 ring-inset bg-rose-50 text-rose-700 ring-rose-200">
                Declined
              </span>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Stage on
              </div>
              <div className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {fmtDate(estimate.stage_date)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Destage on
              </div>
              <div className="font-medium text-slate-900 dark:text-slate-100 mt-0.5">
                {fmtDate(estimate.destage_date)}
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
              Services
            </div>
            <div className="space-y-2">
              {lineItems.map((li, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-slate-800 dark:text-slate-200">{li.label}</span>
                  <span className="font-medium tabular-nums">
                    {fmtMoney(li.amount)}
                  </span>
                </div>
              ))}
              {breakdown.discount > 0 && (
                <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
                  <span>Discount</span>
                  <span>-{fmtMoney(breakdown.discount)}</span>
                </div>
              )}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2 flex items-center justify-between font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{fmtMoney(servicesTotal)}</span>
              </div>
            </div>
            {breakdown.package && (
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-3 leading-relaxed">
                {PACKAGE_INCLUDES}
              </p>
            )}
          </div>

          {/* Action buttons or settled message */}
          {settled ? (
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4 text-sm text-slate-600 dark:text-slate-400">
              {isAccepted ? (
                <>
                  Thanks — we&rsquo;ve received your acceptance.{" "}
                  <strong className="text-slate-800 dark:text-slate-200">
                    Next step: check your email for the staging agreement to
                    sign.
                  </strong>{" "}
                  Your stage isn&rsquo;t confirmed until the agreement is
                  signed.
                </>
              ) : (
                "We've recorded your decline. Reach out if anything changes."
              )}
            </div>
          ) : (
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
              <p className="text-sm text-slate-700 dark:text-slate-300 mb-3">
                Please review the estimate above and let us know whether to
                proceed. After you accept, we&rsquo;ll email you the staging
                agreement to sign.
              </p>
              <EstimateAcceptButtons token={token} />
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-slate-500 dark:text-slate-400 mt-6">
        Questions? Contact Revive Design Collective directly.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Image
            src="/icon.png"
            alt="Revive Design Collective"
            width={36}
            height={36}
            className="w-9 h-9 object-contain"
            priority
          />
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            Revive Design Collective
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
