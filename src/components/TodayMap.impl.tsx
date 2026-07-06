"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import Link from "next/link";
import "leaflet/dist/leaflet.css";

export type TeamKey = "grey" | "white" | "little";

export type TodayMapPin = {
  id: string;
  address: string;
  city: string | null;
  clientName: string | null;
  kind: "stage" | "destage";
  team: TeamKey | null;
  lat: number;
  lng: number;
};

const KIND_COLORS = {
  stage: "#3b82f6", // blue-500 — matches the Stage tag elsewhere
  destage: "#f97316", // orange-500 — matches the Destage tag
};

type FilterKey = "all" | TeamKey;

const TEAM_FILTERS: { key: FilterKey; label: string; dot: string }[] = [
  { key: "all", label: "All", dot: "bg-slate-400" },
  { key: "grey", label: "Grey", dot: "bg-slate-600" },
  { key: "white", label: "White", dot: "bg-white border border-slate-400" },
  { key: "little", label: "Little", dot: "bg-amber-500" },
];

function colorIcon(hex: string) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 28 36">
      <path fill="${hex}" stroke="white" stroke-width="2" d="M14 0C6.27 0 0 6.27 0 14c0 8.5 14 22 14 22s14-13.5 14-22c0-7.73-6.27-14-14-14z"/>
      <circle cx="14" cy="14" r="5" fill="white"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "shs-pin",
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -26],
  });
}

function barnIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 36 44">
      <path fill="#7c8b76" stroke="white" stroke-width="2" d="M18 0C8 0 0 8 0 18c0 11 18 26 18 26s18-15 18-26C36 8 28 0 18 0z"/>
      <text x="18" y="24" text-anchor="middle" font-size="14" fill="white">🏠</text>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "shs-pin",
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -30],
  });
}

/**
 * On touch devices, only let the map pan with TWO fingers — a single
 * finger scrolls the page past the map instead of getting trapped
 * panning it. Pinch-zoom (touchZoom) is unaffected, and desktop
 * mouse-drag is untouched (touch events never fire there).
 */
function TwoFingerPan() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) map.dragging.enable();
      else map.dragging.disable();
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) map.dragging.disable();
    };
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchend", onTouchEnd);
    };
  }, [map]);
  return null;
}

function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  if (points.length > 0) {
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
  }
  return null;
}

/**
 * Small map shown above the Today section on the dashboard.
 *
 * Pins are colored blue (stage) / orange (destage) and can be filtered
 * by team via the chip row. The filter defaults to whichever team the
 * current user is on for today (passed in by the server) so a stager
 * lands on their own crew's stops without having to fiddle.
 */
export default function TodayMap({
  pins,
  barn,
  defaultTeam = null,
}: {
  pins: TodayMapPin[];
  barn: { lat: number; lng: number } | null;
  /** Team to pre-select; null → "All". */
  defaultTeam?: TeamKey | null;
}) {
  const [filter, setFilter] = useState<FilterKey>(defaultTeam ?? "all");

  // Per-team counts driven off the unfiltered list (so the badge shows
  // the true total per team, not the post-filter count).
  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = {
      all: pins.length,
      grey: 0,
      white: 0,
      little: 0,
    };
    for (const p of pins) {
      if (p.team) c[p.team] += 1;
    }
    return c;
  }, [pins]);

  const filteredPins = useMemo(() => {
    if (filter === "all") return pins;
    return pins.filter((p) => p.team === filter);
  }, [pins, filter]);

  const points: Array<[number, number]> = filteredPins.map((p) => [
    p.lat,
    p.lng,
  ]);
  if (barn) points.push([barn.lat, barn.lng]);

  const center: [number, number] = barn
    ? [barn.lat, barn.lng]
    : filteredPins[0]
    ? [filteredPins[0].lat, filteredPins[0].lng]
    : pins[0]
    ? [pins[0].lat, pins[0].lng]
    : [38.5816, -121.4944];

  // Re-key the MapContainer when the filter changes so FitBounds runs
  // again against the new point set (otherwise Leaflet keeps the
  // previous bounds and the filtered pins can drift off-screen).
  const mapKey = `${filter}-${filteredPins.length}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {TEAM_FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition border ${
                active
                  ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white"
                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800"
              }`}
              aria-pressed={active}
            >
              <span className={`w-2 h-2 rounded-full ${f.dot}`} />
              {f.label}
              <span
                className={`text-[10px] tabular-nums ${
                  active
                    ? "text-white/70 dark:text-slate-900/70"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {counts[f.key]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-900 h-48 sm:h-56">
        <MapContainer
          key={mapKey}
          center={center}
          zoom={11}
          scrollWheelZoom={false}
          className="h-full w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds points={points} />
          <TwoFingerPan />

          {barn && (
            <Marker position={[barn.lat, barn.lng]} icon={barnIcon()}>
              <Popup>
                <div className="font-semibold">Barn</div>
                <div className="text-xs text-slate-600">6135 Rio Linda Blvd</div>
              </Popup>
            </Marker>
          )}

          {filteredPins.map((p) => (
            <Marker
              key={`${p.kind}-${p.id}`}
              position={[p.lat, p.lng]}
              icon={colorIcon(KIND_COLORS[p.kind])}
            >
              <Popup>
                <div className="space-y-1 min-w-[180px]">
                  <div className="font-semibold">{p.address}</div>
                  {p.city && (
                    <div className="text-xs text-slate-500">{p.city}</div>
                  )}
                  {p.clientName && (
                    <div className="text-xs text-slate-700">{p.clientName}</div>
                  )}
                  <div className="text-xs">
                    <span
                      className="inline-block w-2 h-2 rounded-full align-middle mr-1"
                      style={{ backgroundColor: KIND_COLORS[p.kind] }}
                    />
                    {p.kind === "stage" ? "Stage" : "Destage"}
                    {p.team && (
                      <span className="ml-1 text-slate-500 capitalize">
                        · {p.team}
                      </span>
                    )}
                  </div>
                  <Link
                    href={`/stages/${p.id}`}
                    className="block text-xs text-brand hover:underline pt-1"
                  >
                    Open stage →
                  </Link>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <p className="sm:hidden text-[11px] text-slate-400 dark:text-slate-500 px-1">
        Use two fingers to move the map.
      </p>
    </div>
  );
}
