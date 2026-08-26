import Image from "next/image";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import IntakeForm from "./IntakeForm";

export const dynamic = "force-dynamic";

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createAdminClient(url, key, { auth: { persistSession: false } });
}

/**
 * Public realtor-intake page — no auth. The realtor opens this from the
 * email link and enters the homeowner's name + email. Identified by
 * intake_token; once submitted the token moves to intake_token_consumed
 * so a refresh shows the "already submitted" state.
 */
export default async function IntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sb = admin();

  const { data: active } = await sb
    .from("stages")
    .select("id, address, client:clients(name)")
    .eq("intake_token", token)
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
              Homeowner details
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Staging at <strong>{active.address}</strong>
              {agentName ? <> · referred by {agentName}</> : null}
            </p>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Enter your client&rsquo;s name and email below. We&rsquo;ll send them
            the staging agreement to sign and, once signed, the invoice — so
            you&rsquo;re kept out of the paperwork.
          </p>
          <IntakeForm token={token} />
        </div>
      </Shell>
    );
  }

  // Already submitted?
  const { data: consumed } = await sb
    .from("stages")
    .select("address, homeowner_name")
    .eq("intake_token_consumed", token)
    .maybeSingle();

  if (consumed) {
    return (
      <Shell>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
            You&rsquo;re all set
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            The homeowner details for <strong>{consumed.address}</strong> have
            been submitted
            {consumed.homeowner_name ? <> ({consumed.homeowner_name})</> : null}.
            The agreement is on its way to them, and their invoice follows once
            it&rsquo;s signed. Nothing more to do here.
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
          This intake link is invalid or has expired. Please contact Revive
          Design Collective for a new one.
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
