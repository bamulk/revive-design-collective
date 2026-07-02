import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { loadStageByToken } from "@/lib/extension-core";
import { formatMDY } from "@/lib/time";
import ExtensionActions from "./ExtensionActions";

/**
 * Public extension confirmation page — clients land here from the
 * 10-day-before-destage email. No auth required (token in URL is
 * the credential).
 */
export const dynamic = "force-dynamic";

export default async function ExtensionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const stage = await loadStageByToken(token);
  if (!stage) notFound();

  // If the token was already used (extend or destage chosen), show a
  // confirmation screen instead.
  const alreadyDecided = stage.extension_token == null;

  const extensionPreviewAmount = Math.round(Number(stage.amount ?? 0) * 50) / 100;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-7 space-y-5">
        <div className="flex items-center gap-3">
          <Image
            src="/icon.png"
            alt="Revive Design Collective"
            width={48}
            height={48}
            className="w-12 h-12 object-contain"
            priority
          />
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Revive Design Collective
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Extension request
            </p>
          </div>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-2">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Property:{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {stage.address}
              {stage.city ? `, ${stage.city}` : ""}
            </span>
          </p>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Scheduled destage:{" "}
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {formatMDY(stage.destage_date)}
            </span>
          </p>
        </div>

        {alreadyDecided ? (
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-lg p-4 text-sm text-emerald-800 dark:text-emerald-200">
            <p className="font-medium">Thanks — we got your response.</p>
            <p className="mt-1 text-emerald-700 dark:text-emerald-300 text-xs">
              If you need to make a change, give us a call.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
              <p>
                Your staging contract is ending. Choose one of the
                options below:
              </p>
              <ul className="space-y-2 pl-1">
                <li className="flex gap-2">
                  <span aria-hidden>🏠</span>
                  <span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      Extend 30 more days
                    </span>{" "}
                    — keep the furniture in place; we&apos;ll send an
                    invoice for{" "}
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      ${extensionPreviewAmount.toFixed(2)}
                    </span>{" "}
                    (50% of your original).
                  </span>
                </li>
                <li className="flex gap-2">
                  <span aria-hidden>📦</span>
                  <span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      Schedule destage
                    </span>{" "}
                    — we&apos;ll pick everything up on{" "}
                    {formatMDY(stage.destage_date)}.
                  </span>
                </li>
              </ul>
            </div>

            <ExtensionActions token={token} />
          </>
        )}

        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center pt-2">
          Questions? Reply to the original email or call us.
        </p>
      </div>
    </div>
  );
}
