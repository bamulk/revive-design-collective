import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import SignOutButton from "@/components/SignOutButton";
import PullToRefresh from "@/components/PullToRefresh";

/**
 * Portal layout. Acts as the auth/role gate for the /portal subtree.
 *
 *  - No session → bounce to /portal/login.
 *  - Team member (has a profiles row) → bounce to /.
 *  - First-time client sign-in: look up clients by email and write
 *    `auth_user_id` so RLS can scope subsequent queries.
 *  - Email matches no client → sign out and bounce to /portal/login.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  // Team members shouldn't end up in the portal — send them home.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role === "admin" || profile?.role === "stager") {
    redirect("/");
  }

  // Match the signed-in user to a clients row. Use the admin client
  // for the initial lookup since RLS only lets a client read their
  // OWN row, and on first login auth_user_id isn't linked yet.
  const admin = createAdminClient();
  let client: { id: string; name: string | null } | null = null;

  const { data: byId } = await admin
    .from("clients")
    .select("id, name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (byId) {
    client = byId;
  } else if (user.email) {
    const { data: byEmail } = await admin
      .from("clients")
      .select("id, name, auth_user_id")
      .ilike("email", user.email)
      .limit(1)
      .maybeSingle();
    // Only auto-link if no other auth user has already claimed this row.
    if (byEmail && !byEmail.auth_user_id) {
      await admin
        .from("clients")
        .update({ auth_user_id: user.id })
        .eq("id", byEmail.id);
      client = { id: byEmail.id, name: byEmail.name };
    }
  }

  if (!client) {
    // No match. We DON'T sign out here — clearing the cookie on a
    // server-side redirect races with the browser's next request and
    // can land us in a redirect loop. Instead, bounce to /portal/login,
    // which now detects the signed-in-but-unmatched state and shows a
    // client-side Sign out button.
    redirect("/portal/login?error=no_match");
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <PullToRefresh />
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/portal" className="flex items-center gap-2.5">
            <Image
              src="/icon.png"
              alt="Revive Design Collective"
              width={36}
              height={36}
              className="w-9 h-9 object-contain"
              priority
            />
            <div className="leading-tight">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Revive Design Collective
              </div>
              {client.name && (
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {client.name}
                </div>
              )}
            </div>
          </Link>
          <SignOutButton
            redirectTo="/portal/login"
            className="inline-flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300 hover:text-rose-700"
          >
            <LogOut size={14} /> Sign out
          </SignOutButton>
        </div>
      </header>
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
