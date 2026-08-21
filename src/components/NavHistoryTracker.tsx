"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const KEY = "shs-nav-stack";
const MAX = 30;

/** Paths the user actually visited inside the app, oldest → newest. */
export function readNavStack(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Records every in-app route change into sessionStorage so BackLink
 * can return the user to the page they actually came from — without
 * trusting browser history, which is full of sign-in redirects,
 * /auth/callback hops, and other tabs' pages. Mounted once in the
 * (app) layout; renders nothing.
 */
export default function NavHistoryTracker() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    const qs = search?.toString();
    const here = qs ? `${pathname}?${qs}` : pathname;
    const stack = readNavStack();
    if (stack[stack.length - 1] === here) return; // refresh / re-render
    stack.push(here);
    while (stack.length > MAX) stack.shift();
    try {
      sessionStorage.setItem(KEY, JSON.stringify(stack));
    } catch {
      // Storage full/unavailable — Back just falls back to its default.
    }
  }, [pathname, search]);

  return null;
}
