"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import AppLoadingIndicator from "./AppLoadingIndicator";

/**
 * Global page-transition loading overlay.
 * Shows a spinning house icon when the route is changing.
 *
 * Uses pathname changes to detect navigation start/end. Also intercepts
 * clicks on <a> and <button type="submit"> so the spinner appears
 * instantly on tap — before Next.js starts the server render.
 */
export default function RouteLoader() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);

  // When pathname changes, the new page has arrived — hide spinner.
  useEffect(() => {
    if (pathname !== prevPath) {
      setPrevPath(pathname);
      setLoading(false);
    }
  }, [pathname, prevPath]);

  // Intercept link clicks and form submissions to show spinner early.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;

      // Find the closest <a> with an internal href.
      const link = target.closest("a[href]") as HTMLAnchorElement | null;
      if (link) {
        const href = link.getAttribute("href") ?? "";
        // Only internal navigation (not external links, anchors, or tel/sms/mailto).
        if (
          href.startsWith("/") &&
          !href.startsWith("//") &&
          !link.target &&
          !link.hasAttribute("download") &&
          href !== pathname
        ) {
          setLoading(true);
          return;
        }
      }

      // Form submit buttons (server actions trigger page transitions).
      const btn = target.closest(
        'button[type="submit"], button:not([type])',
      ) as HTMLButtonElement | null;
      if (btn) {
        const form = btn.closest("form");
        // Forms that mutate IN PLACE (the stage edit form flips
        // client-side, inline autosaves, etc.) opt out with
        // data-no-loader. Otherwise the overlay would show on submit and
        // never hide — there's no navigation, so no pathname change to
        // clear it, and it would sit until the 8s safety timeout.
        const optedOut =
          btn.hasAttribute("data-no-loader") ||
          !!form?.hasAttribute("data-no-loader");
        if (
          !optedOut &&
          (form?.getAttribute("action") || btn.hasAttribute("formaction"))
        ) {
          setLoading(true);
        }
      }
    }

    document.addEventListener("click", handleClick, { capture: true });
    return () =>
      document.removeEventListener("click", handleClick, { capture: true });
  }, [pathname]);

  // Safety timeout — hide after 8s even if something goes wrong.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setLoading(false), 8000);
    return () => clearTimeout(t);
  }, [loading]);

  if (!loading) return null;
  // Same indicator the cold-start /loading.tsx renders, so navigation
  // and cold loads look identical.
  return <AppLoadingIndicator />;
}
