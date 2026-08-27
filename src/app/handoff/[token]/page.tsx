import Image from "next/image";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import HandoffForm from "./HandoffForm";

export const dynamic = "force-dynamic";

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createAdminClient(url, key, { auth: { persistSession: false } });
}

/**
 * Public signer-choice page — no auth. The agent opens this from the
 * "who should sign?" email and picks: sign it themselves, or pass it to
 * their seller. No agreement goes out until they choose. Identified by
 * handoff_token; once used the token moves to handoff_token_consumed so
 * a refresh shows the decided state instead of the chooser.
 */
export default async function HandoffPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = admin();

  const { data: active } = await sb
    .from("stages")
    .select("id, address, client:clients(name)")
    .eq("handoff_token", token)
    .maybeSingle();

  if (active) {
    const agent = Array.isArray(active.client)
      ? active.client[0]
      : active.client;
    const agentName = (agent as { name?: string } | null)?.name ?? null;
    return (
      <Shell>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-6 sm:p-8 space-y-5">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Who should sign?
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Staging at <strong>{active.address}</strong>
              {agentName ? <> · {agentName}</> : null}
            </p>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Pick who takes this staging on. Whoever you choose receives the
            agreement to sign and, once signed, the invoice. Nothing has been
            sent yet.
          </p>
          <HandoffForm token={token} />
        </div>
      </Shell>
    );
  }

  // Already handed off?
  const { data: consumed } = await sb
    .from("stages")
    .select("address, homeowner_name")
    .eq("handoff_token_consumed", token)
    .maybeSingle();

  if (consumed) {
    // No homeowner recorded means the agent kept it for themselves.
    const seller = consumed.homeowner_name;
    return (
      <Shell>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Already decided
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {seller ? (
              <>
                The staging at <strong>{consumed.address}</strong> was sent to{" "}
                <strong>{seller}</strong>. They sign the agreement and receive
                the invoice — nothing further is needed from you.
              </>
            ) : (
              <>
                The agreement for <strong>{consumed.address}</strong> was sent
                to you to sign. Check your inbox — the invoice follows once
                it&rsquo;s signed.
              </>
            )}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
          Link not available
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          This link is invalid or has expired. Please contact Revive Design
          Collective for a new one.
        </p>
      </div>
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
