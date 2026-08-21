import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NavBar from "@/components/NavBar";
import RouteLoader from "@/components/RouteLoader";
import PullToRefresh from "@/components/PullToRefresh";
import OfflineSupport from "@/components/OfflineSupport";
import PhotoOutboxPill from "@/components/PhotoOutboxPill";
import NavHistoryTracker from "@/components/NavHistoryTracker";
import { Suspense } from "react";
import { TEAM_ROLES, canEstimate } from "@/lib/permissions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  // Users without a team profile are clients — bounce them to the
  // portal so they never see the staff dashboard.
  if (
    !profile ||
    !(TEAM_ROLES as readonly string[]).includes(profile.role ?? "")
  ) {
    redirect("/portal");
  }

  const isAdmin = profile.role === "admin";
  const userCanEstimate = canEstimate(profile.role);

  return (
    <div className="min-h-screen flex flex-col">
      <RouteLoader />
      <PullToRefresh />
      {/* Offline: SW registration + offline banner + photo outbox. */}
      <OfflineSupport />
      <PhotoOutboxPill />
      {/* Records in-app route changes so Back links return to the page
          the user actually came from. useSearchParams needs Suspense. */}
      <Suspense fallback={null}>
        <NavHistoryTracker />
      </Suspense>
      {/* vapidPublicKey is passed to every team member (stagers + lead
          stagers + admins) so they can all enable the push toggle;
          stagers receive crew-assignment alerts once they turn it on. */}
      <NavBar
        isAdmin={!!isAdmin}
        canEstimate={userCanEstimate}
        displayName={profile?.full_name || user.email || ""}
        vapidPublicKey={process.env.VAPID_PUBLIC_KEY?.trim() || undefined}
      />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-[calc(env(safe-area-inset-bottom)+6rem)] md:pb-8">
        {children}
      </main>
    </div>
  );
}
