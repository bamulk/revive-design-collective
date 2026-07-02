"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowDown } from "lucide-react";

/**
 * Custom pull-to-refresh. Installed PWAs (and standalone iOS) have no
 * native pull-to-refresh, so this adds one: pull down from the very top
 * of the page and release past the threshold to re-fetch server data
 * via router.refresh().
 *
 * Only engages when the window is scrolled to the very top and the user
 * drags downward; otherwise it stays out of the way of normal scrolling.
 */
const THRESHOLD = 64; // px pull (after resistance) to trigger
const MAX = 96; // px cap on the indicator travel
const RESIST = 0.5; // finger-to-pull ratio

export default function PullToRefresh() {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startY = useRef<number | null>(null);
  const active = useRef(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  // Follow the finger 1:1 while dragging; ease back on release.
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    function onStart(e: TouchEvent) {
      if (refreshingRef.current || window.scrollY > 0 || e.touches.length !== 1) {
        active.current = false;
        return;
      }
      startY.current = e.touches[0].clientY;
      active.current = true;
      setAnimate(false);
    }

    function onMove(e: TouchEvent) {
      if (!active.current || startY.current == null) return;
      const dy = e.touches[0].clientY - startY.current;
      // Cancel if scrolled away from top or pulling up.
      if (window.scrollY > 0 || dy <= 0) {
        if (pullRef.current !== 0) {
          pullRef.current = 0;
          setPull(0);
        }
        if (dy <= 0) active.current = false;
        return;
      }
      const dist = Math.min(MAX, dy * RESIST);
      pullRef.current = dist;
      setPull(dist);
      // Suppress the native overscroll bounce while we own the gesture.
      if (dist > 2 && e.cancelable) e.preventDefault();
    }

    function onEnd() {
      if (!active.current) return;
      active.current = false;
      startY.current = null;
      setAnimate(true);
      if (pullRef.current >= THRESHOLD && !refreshingRef.current) {
        refreshingRef.current = true;
        setRefreshing(true);
        pullRef.current = THRESHOLD;
        setPull(THRESHOLD);
        router.refresh();
        // router.refresh() returns void; give the refresh a moment, then
        // retract the indicator.
        window.setTimeout(() => {
          refreshingRef.current = false;
          setRefreshing(false);
          pullRef.current = 0;
          setPull(0);
        }, 750);
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [router]);

  const visible = pull > 0 || refreshing;
  const ready = pull >= THRESHOLD;

  return (
    <div
      aria-hidden={!visible}
      className="md:hidden fixed inset-x-0 top-0 z-[1050] flex justify-center pointer-events-none"
      style={{
        // Sit just below the notch / status bar.
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <div
        className="mt-1 flex items-center justify-center w-9 h-9 rounded-full bg-white dark:bg-slate-800 shadow-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
        style={{
          transform: `translateY(${pull - 44}px)`,
          opacity: visible ? Math.min(1, pull / THRESHOLD || 1) : 0,
          transition: animate
            ? "transform 0.2s ease, opacity 0.2s ease"
            : "none",
        }}
      >
        {refreshing ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <ArrowDown
            size={16}
            className="transition-transform"
            style={{ transform: ready ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        )}
      </div>
    </div>
  );
}
