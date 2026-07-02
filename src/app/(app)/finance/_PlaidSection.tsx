import { CheckCircle2, AlertTriangle, Building2 } from "lucide-react";
import { Card } from "@/components/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import PlaidLinkButton from "@/components/PlaidLinkButton";
import PlaidItemRowActions from "./PlaidItemRowActions";
import { formatMDY } from "@/lib/time";

/**
 * Plaid connection panel on /finance. Lists each linked bank with its
 * last sync time + any last error, plus a "Connect a bank" button to
 * link more accounts. Uses the service-role admin client because
 * plaid_items is RLS-locked to internal users and we want to keep that
 * separate from query session state.
 */
export default async function PlaidSection() {
  const admin = createAdminClient();
  const { data: items } = await admin
    .from("plaid_items")
    .select(
      "id, institution_name, institution_id, last_synced_at, last_error, created_at",
    )
    .order("created_at", { ascending: true });

  const list = (items ?? []) as Array<{
    id: string;
    institution_name: string | null;
    institution_id: string | null;
    last_synced_at: string | null;
    last_error: string | null;
    created_at: string;
  }>;

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Bank connections
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Plaid pulls new transactions automatically. CSV import remains
            available as a backup.
          </p>
        </div>
        <PlaidLinkButton />
      </div>

      {list.length > 0 && (
        <ul className="space-y-2">
          {list.map((it) => (
            <li
              key={it.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3"
            >
              <div className="min-w-0 flex items-start gap-2.5">
                <Building2
                  size={16}
                  className="mt-0.5 text-slate-500 dark:text-slate-400 shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {it.institution_name || "Bank connection"}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Connected {formatMDY(it.created_at)}
                    {it.last_synced_at && (
                      <>
                        {" · "}
                        Last sync {formatMDY(it.last_synced_at)}
                      </>
                    )}
                  </div>
                  {it.last_error ? (
                    <div className="text-xs text-rose-700 dark:text-rose-300 mt-0.5 inline-flex items-center gap-1">
                      <AlertTriangle size={11} /> {it.last_error}
                    </div>
                  ) : it.last_synced_at ? (
                    <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5 inline-flex items-center gap-1">
                      <CheckCircle2 size={11} /> In sync
                    </div>
                  ) : null}
                </div>
              </div>
              <PlaidItemRowActions id={it.id} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
