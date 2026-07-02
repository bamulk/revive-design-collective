"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * "Back" link that always navigates to its declared `fallback` href.
 *
 * We used to do `router.back()` when `window.history.length > 1`, but
 * almost every visit to a page has prior history (sign-in redirect,
 * auth callback, tab from another site) — so back was effectively
 * always firing and the user would land somewhere unrelated like
 * /auth/callback or a previous tab's page. Predictable beats clever:
 * the fallback href IS where the user should land, every time.
 *
 * It also PREFETCHES that target on mount. The detail page sits idle
 * while the user reads, so warming the list RSC into the client Router
 * Cache (paired with experimental.staleTimes.dynamic) makes the Back
 * tap render from cache with no server round-trip — the main fix for
 * "slow after viewing a stage." A default <Link> only prefetches the
 * loading boundary for dynamic routes, so we call router.prefetch
 * explicitly to fetch the full payload.
 */
export default function BackLink({
  fallback,
  children,
  className,
}: {
  fallback: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    router.prefetch(fallback);
  }, [router, fallback]);

  return (
    <Link href={fallback} prefetch className={className}>
      {children}
    </Link>
  );
}
