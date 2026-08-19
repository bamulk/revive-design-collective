import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import PasskeyManager from "@/components/PasskeyManager";

/**
 * Personal account page for team members — currently hosts the
 * passkey manager. The (app) layout already gates this to signed-in
 * team members, so no extra role check here.
 */
export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user!.id)
    .maybeSingle();

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="Account"
        subtitle={`${profile?.full_name ?? user?.email ?? ""}${
          profile?.role ? ` · ${profile.role.replace(/_/g, " ")}` : ""
        }`}
      />
      <section className="bg-white dark:bg-slate-900 border rounded-xl p-5 space-y-1 text-sm">
        <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Signed in as
        </div>
        <div className="font-medium text-slate-900 dark:text-slate-100">
          {user?.email}
        </div>
      </section>
      <PasskeyManager />
    </div>
  );
}
