"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clearOfflineData } from "@/lib/photo-outbox";

export default function SignOutButton({
  redirectTo = "/login",
  className = "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:text-slate-100 underline",
  children,
}: {
  redirectTo?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const supabase = createClient();
  return (
    <button
      onClick={async () => {
        // Wipe offline caches + the photo outbox FIRST — a shared
        // device must not serve this user's cached pages offline or
        // upload their queued photos under the next session.
        await clearOfflineData();
        await supabase.auth.signOut();
        router.push(redirectTo);
        router.refresh();
      }}
      className={className}
    >
      {children ?? "Sign out"}
    </button>
  );
}
