"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Offline plumbing for the app shell:
 *
 * 1. Registers the service worker on every visit. It was previously
 *    registered only when someone enabled push notifications — offline
 *    caching needs it installed for everyone. (register() is idempotent
 *    for the same script/scope, so this coexists with the push toggles.)
 *
 * 2. Shows a slim "offline" banner while there's no connectivity, so
 *    stale-but-cached pages are clearly labeled instead of silently
 *    passing as fresh.
 */
export default function OfflineSupport() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failures (private mode, unsupported) are fine —
        // the app just behaves like it did before offline support.
      });
    }

    setOffline(!navigator.onLine);
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="fixed left-1/2 -translate-x-1/2 z-[1300] flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-900 ring-1 ring-amber-300 px-3 py-1.5 text-xs font-medium shadow-md dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)" }}
    >
      <WifiOff size={13} />
      Offline — showing saved data
    </div>
  );
}
