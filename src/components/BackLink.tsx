"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { readNavStack } from "./NavHistoryTracker";

/** Only ever send Back to a real app page — never auth/login/portal. */
const APP_PATH = /^\/(?!login|auth\b|auth\/|portal|set-password)/;

/**
 * "Back" link that returns to the page the user actually came from.
 *
 * Target = the most recent DIFFERENT entry in the in-app navigation
 * stack (see NavHistoryTracker), falling back to the declared
 * `fallback` href when there is none (deep link from an email, fresh
 * PWA launch). We deliberately don't use router.back(): browser
 * history is full of sign-in redirects and /auth/callback hops, so it
 * used to land users somewhere unrelated.
 *
 * The target is resolved client-side after mount (sessionStorage), so
 * the server-rendered href is the fallback and swaps once hydrated.
 * It's also PREFETCHED so the tap renders from the Router Cache.
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
  const [target, setTarget] = useState(fallback);

  useEffect(() => {
    const here = window.location.pathname + window.location.search;
    const stack = readNavStack();
    // Walk back past the current page (it may or may not have been
    // recorded yet, depending on effect order) to the previous entry.
    let prev: string | undefined;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i] !== here) {
        prev = stack[i];
        break;
      }
    }
    setTarget(prev && APP_PATH.test(prev) ? prev : fallback);
  }, [fallback]);

  useEffect(() => {
    router.prefetch(target);
  }, [router, target]);

  return (
    <Link href={target} prefetch className={className}>
      {children}
    </Link>
  );
}
