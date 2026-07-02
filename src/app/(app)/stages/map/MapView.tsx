"use client";

import { useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import Link from "next/link";
import "leaflet/dist/leaflet.css";

export type MapStage = {
  id: string;
  address: string;
  city: string | null;
  status: string;
  stageDate: string | null;
  destageDate: string | null;
  clientName: string | null;
  lat: number;
  lng: number;
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: "#3b82f6", // blue-500
  staged: "#f97316", // orange-500
  destaged: "#10b981", // emerald-500
  completed: "#64748b", // slate-500
};

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Upcoming",
  staged: "Staged",
  destaged: "Destages",
  completed: "Completed",
};

// Completed stages are filtered out at the SQL layer — no chip for them.
const ALL_STATUSES = ["scheduled", "staged", "destaged"] as const;

/** Build a small SVG marker icon in the given hex color. */
function colorIcon(hex: string) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path fill="${hex}" stroke="white" stroke-width="2" d="M14 0C6.27 0 0 6.27 0 14c0 8.5 14 22 14 22s14-13.5 14-22c0-7.73-6.27-14-14-14z"/>
      <circle cx="14" cy="14" r="5" fill="white"/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "shs-pin", // empty class — div has no extra styles
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -30],
  });
}

function barnIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
      <path fill="#a9761e" stroke="white" stroke-width="2" d="M18 0C8 0 0 8 0 18c0 11 18 26 18 26s18-15 18-26C36 8 28 0 18 0z"/>
      <text x="18" y="24" text-anchor="middle" font-size="16" fill="white">🏠</text>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: "shs-pin",
    iconSize: [36, 44],
    iconAnchor: [18, 44],
    popupAnchor: [0, -38],
  });
}

/** Auto-fit the map to a set of points whenever they change. */
function FitBounds({
  points,
}: {
  points: Array<[number, number]>;
}) {
  const map = useMap();
  if (points.length > 0) {
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }
  return null;
}

export default function MapView({
  stages,
  barn,
}: {
  stages: MapStage[];
  barn: { lat: number; lng: number } | null;
}) {
  // Status filter — bitmask via Set of enabled status keys.
  const [enabled, setEnabled] = useState<Set<string>>(
    new Set(ALL_STATUSES),
  );

  const filtered = useMemo(
    () => stages.filter((s) => enabled.has(s.status)),
    [stages, enabled],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of stages) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [stages]);

  // Default center: barn if known, else center of Sacramento.
  const center: [number, number] = barn
    ? [barn.lat, barn.lng]
    : [38.5816, -121.4944];

  const points: Array<[number, number]> = filtered.map((s) => [s.lat, s.lng]);
  if (barn) points.push([barn.lat, barn.lng]);

  function toggle(status: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {ALL_STATUSES.map((s) => {
          const isOn = enabled.has(s);
          const color = STATUS_COLORS[s];
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border transition ${
                isOn
                  ? "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200"
                  : "bg-slate-100 dark:bg-slate-800 border-transparent text-slate-400 dark:text-slate-500 line-through"
              }`}
              aria-pressed={isOn}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              {STATUS_LABEL[s]}
              <span className="text-slate-500 dark:text-slate-400 font-normal">
                ({counts[s] ?? 0})
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-900 h-[60vh] sm:h-[70vh]">
        {stages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-400 text-center px-6">
            No stages have been geocoded yet. Click an individual stage to
            populate its location, or use the bulk geocode button.
          </div>
        ) : (
          <MapContainer
            center={center}
            zoom={11}
            scrollWheelZoom
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds points={points} />

            {/* Barn marker */}
            {barn && (
              <Marker position={[barn.lat, barn.lng]} icon={barnIcon()}>
                <Popup>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">Barn</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    6135 Rio Linda Blvd
                  </div>
                </Popup>
              </Marker>
            )}

            {filtered.map((s) => (
              <Marker
                key={s.id}
                position={[s.lat, s.lng]}
                icon={colorIcon(
                  STATUS_COLORS[s.status] ?? STATUS_COLORS.completed,
                )}
              >
                <Popup>
                  <div className="space-y-1 min-w-[200px]">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {s.address}
                    </div>
                    {s.city && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">{s.city}</div>
                    )}
                    {s.clientName && (
                      <div className="text-xs text-slate-700 dark:text-slate-300">
                        {s.clientName}
                      </div>
                    )}
                    <div className="text-xs">
                      <span
                        className="inline-block w-2 h-2 rounded-full align-middle mr-1"
                        style={{
                          backgroundColor:
                            STATUS_COLORS[s.status] ?? STATUS_COLORS.completed,
                        }}
                      />
                      {STATUS_LABEL[s.status] ?? s.status}
                    </div>
                    {(s.stageDate || s.destageDate) && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {s.stageDate && <>Stage: {s.stageDate}</>}
                        {s.stageDate && s.destageDate && " · "}
                        {s.destageDate && <>Destage: {s.destageDate}</>}
                      </div>
                    )}
                    <Link
                      href={`/stages/${s.id}`}
                      className="block text-xs text-brand hover:underline pt-1"
                    >
                      Open stage →
                    </Link>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        )}
      </div>
    </div>
  );
}
