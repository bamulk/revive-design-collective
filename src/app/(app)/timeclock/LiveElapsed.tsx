"use client";

import { useEffect, useState } from "react";
import { fmtDuration } from "@/lib/timeclock";

/**
 * Ticking elapsed-time label for the open clock-in. Starts at the
 * server-rendered value (0 until mounted to avoid a hydration mismatch),
 * then updates every 30s.
 */
export default function LiveElapsed({ since }: { since: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const start = Date.parse(since);
  const ms = (now ?? start) - start;
  return <span>{fmtDuration(ms)}</span>;
}
