"use client";

import { useEffect } from "react";

/**
 * Remembers where you were on a list page when you click through to a
 * stage, and puts you back there when you return.
 *
 * The app's "← Back" links are deliberate FORWARD navigations (see
 * BackLink.tsx — history.back() misfired after auth redirects), which
 * means the browser's native scroll restoration never applies: coming
 * back to the list always landed at the top.
 *
 * Mechanics:
 * - A capture-phase click listener watches for navigation to a stage
 *   detail page (/stages/{uuid}) and saves the current scroll offset
 *   to sessionStorage under this page's key.
 * - On mount, a saved offset is restored (retrying across a few frames
 *   in case content is still streaming in) and then CLEARED — so a
 *   fresh visit via the nav never jumps, only a round-trip restores.
 */
const STAGE_LINK_RE = /^\/stages\/[0-9a-f]{8}-[0-9a-f-]{27,}$/i;

export default function ScrollMemory({ id }: { id: string }) {
  useEffect(() => {
    const key = `scrollmem:${id}`;

    // Restore once, then clear.
    const saved = Number(sessionStorage.getItem(key) ?? NaN);
    if (Number.isFinite(saved) && saved > 0) {
      sessionStorage.removeItem(key);
      let attempts = 0;
      const tryScroll = () => {
        window.scrollTo(0, saved);
        attempts += 1;
        // Content may still be streaming in — keep nudging for a few
        // frames until the page is tall enough to actually get there.
        const reachable =
          document.documentElement.scrollHeight - window.innerHeight >=
          saved - 2;
        if (!reachable && attempts < 15) requestAnimationFrame(tryScroll);
      };
      requestAnimationFrame(tryScroll);
    }

    // Save on click-through to a stage detail page.
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      try {
        const url = new URL(a.href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        if (STAGE_LINK_RE.test(url.pathname)) {
          sessionStorage.setItem(key, String(window.scrollY));
        }
      } catch {
        // Unparseable href — ignore.
      }
    };
    document.addEventListener("click", onClick, { capture: true });
    return () =>
      document.removeEventListener("click", onClick, { capture: true });
  }, [id]);

  return null;
}
