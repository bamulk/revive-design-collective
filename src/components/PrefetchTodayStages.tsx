"use client";

import { useEffect } from "react";

/**
 * Warms the service worker's offline page cache with today's work while
 * there's still signal (morning coffee / wifi), so crews can open those
 * pages later from a dead zone — even pages they haven't visited yet.
 *
 * Fired from the dashboard with today's stage/destage detail paths plus
 * the core field routes. Each URL is fetched once per day per tab
 * session (sessionStorage guard), sequentially and only when online,
 * with the x-sw-prefetch header the service worker caches by.
 */
export default function PrefetchTodayStages({ paths }: { paths: string[] }) {
  useEffect(() => {
    if (paths.length === 0) return;
    if (!("serviceWorker" in navigator)) return;

    const day = new Date().toISOString().slice(0, 10);
    const key = `sw-prefetch:${day}`;
    if (sessionStorage.getItem(key)) return;

    let cancelled = false;
    // Give first paint + SW registration a moment before warming.
    const timer = setTimeout(async () => {
      // Without a controlling SW the fetches wouldn't be cached.
      if (!navigator.serviceWorker.controller) return;
      if (!navigator.onLine) return;
      // The page HTML alone isn't enough offline — its /_next/static
      // chunks must be cached too or a never-visited page renders dead
      // (no hydration). Collect them from each page's HTML and warm
      // them through the SW's cache-first static route.
      const assets = new Set<string>();
      for (const path of paths) {
        if (cancelled || !navigator.onLine) return;
        try {
          const res = await fetch(path, {
            headers: { "x-sw-prefetch": "1" },
            credentials: "same-origin",
          });
          if (res.ok) {
            const html = await res.text();
            for (const m of html.match(/\/_next\/static\/[^"'\s\\]+/g) ?? []) {
              assets.add(m);
            }
          }
        } catch {
          // Offline mid-loop — stop; we'll retry on the next visit.
          return;
        }
      }
      for (const asset of Array.from(assets).slice(0, 80)) {
        if (cancelled || !navigator.onLine) return;
        try {
          await fetch(asset, { credentials: "same-origin" });
        } catch {
          return;
        }
      }
      sessionStorage.setItem(key, "1");
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [paths]);

  return null;
}
