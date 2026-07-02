"use client";

import dynamic from "next/dynamic";
import type { TodayMapPin } from "./TodayMap.impl";

/**
 * Lazy wrapper around the real TodayMap. Leaflet + react-leaflet add
 * ~150 KB gzipped to the JS bundle, and the dashboard / plan pages
 * often render WITHOUT a map (e.g. nothing scheduled today). Splitting
 * them out keeps the at-a-glance pages quick on slow connections.
 *
 * ssr: false is required because Leaflet touches `window` at import
 * time; next/dynamic can only set ssr:false from a client component,
 * which is why this file lives separately from the impl.
 */
const TodayMap = dynamic(() => import("./TodayMap.impl"), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      aria-label="Loading map"
      className="h-64 sm:h-72 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse"
    />
  ),
});

export type { TodayMapPin };
export default TodayMap;
