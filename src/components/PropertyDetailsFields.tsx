"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Search, Loader2, Home, AlertCircle } from "lucide-react";

interface Props {
  defaultSquareFootage?: string | number;
  defaultBedrooms?: string | number;
  defaultBathrooms?: string | number;
  addressInputName?: string;
  cityInputName?: string;
}

interface PropertyResult {
  sqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  photos: string[];
  propertyType: string | null;
  status: string | null;
  zillowUrl: string | null;
  city: string | null;
  zipCode: string | null;
}

export default function PropertyDetailsFields({
  defaultSquareFootage = "",
  defaultBedrooms = "",
  defaultBathrooms = "",
  addressInputName = "address",
  cityInputName = "city",
}: Props) {
  const [sqft, setSqft] = useState(String(defaultSquareFootage));
  const [beds, setBeds] = useState(String(defaultBedrooms));
  const [baths, setBaths] = useState(String(defaultBathrooms));
  const [photos, setPhotos] = useState<string[]>([]);
  const [propertyType, setPropertyType] = useState<string | null>(null);
  const [propertyStatus, setPropertyStatus] = useState<string | null>(null);
  const [zillowUrl, setZillowUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const lookup = useCallback(async () => {
    const form = document.querySelector("form");
    if (!form) return;
    const addrEl = form.querySelector<HTMLInputElement>(
      `input[name="${addressInputName}"]`,
    );
    const cityEl = form.querySelector<HTMLInputElement>(
      `input[name="${cityInputName}"]`,
    );
    const address = addrEl?.value?.trim() ?? "";
    const city = cityEl?.value?.trim() ?? "";
    if (!address) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setNotFound(false);

    try {
      const params = new URLSearchParams({ address });
      if (city) params.set("city", city);
      const res = await fetch(`/api/property-lookup?${params}`, {
        signal: ac.signal,
      });
      if (!res.ok) throw new Error("API error");
      const json = await res.json();

      if (!json.found) {
        setNotFound(true);
        return;
      }

      const d = json as PropertyResult;
      if (d.sqft != null) setSqft(String(d.sqft));
      if (d.bedrooms != null) setBeds(String(d.bedrooms));
      if (d.bathrooms != null) setBaths(String(d.bathrooms));
      if (d.photos?.length) {
        setPhotos(d.photos);
        setPhotoIdx(0);
      }
      if (d.propertyType) setPropertyType(d.propertyType);
      if (d.status) setPropertyStatus(d.status);
      if (d.zillowUrl) setZillowUrl(d.zillowUrl);
      // Auto-fill the city when Zillow resolved one and the form
      // field is still blank. Dispatch an 'input' event so any
      // listening React state on the city input picks it up.
      if (d.city && cityEl && cityEl.value.trim() === "") {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(cityEl, d.city);
        cityEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("[property-lookup]", err);
        setNotFound(true);
      }
    } finally {
      setLoading(false);
    }
  }, [addressInputName, cityInputName]);

  // Auto-trigger on blur of address/city inputs.
  useEffect(() => {
    const form = document.querySelector("form");
    if (!form) return;

    const addrEl = form.querySelector<HTMLInputElement>(
      `input[name="${addressInputName}"]`,
    );
    const cityEl = form.querySelector<HTMLInputElement>(
      `input[name="${cityInputName}"]`,
    );

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const addr = addrEl?.value?.trim() ?? "";
        if (addr.length > 5) lookup();
      }, 600);
    };

    cityEl?.addEventListener("blur", schedule);
    addrEl?.addEventListener("blur", schedule);

    return () => {
      clearTimeout(timer);
      cityEl?.removeEventListener("blur", schedule);
      addrEl?.removeEventListener("blur", schedule);
    };
  }, [addressInputName, cityInputName, lookup]);

  /** Pretty-print property type for display. */
  const typeLabel = propertyType
    ?.replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const statusLabel = propertyStatus
    ?.replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <fieldset className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
        <Home size={13} />
        Property details
      </legend>

      {/* Hidden field so zillow_url gets submitted with the form */}
      {zillowUrl && <input type="hidden" name="zillow_url" value={zillowUrl} />}

      {/* Lookup button */}
      <button
        type="button"
        onClick={lookup}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs font-medium text-[var(--brand)] hover:text-[var(--brand-hover)] disabled:opacity-50"
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Search size={14} />
        )}
        {loading ? "Searching Zillow…" : "Look up from address"}
      </button>

      {notFound && (
        <p className="text-xs text-amber-600 flex items-center gap-1">
          <AlertCircle size={13} />
          Property not found — enter details manually
        </p>
      )}

      {/* Beds / baths / sqft */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block text-sm">
          Square footage
          <input
            name="square_footage"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={sqft}
            onChange={(e) => setSqft(e.target.value)}
            placeholder="e.g. 1850"
            className="mt-1 w-full border rounded px-3 py-2.5 text-base bg-white dark:bg-slate-900"
          />
        </label>
        <label className="block text-sm">
          Bedrooms
          <input
            name="bedrooms"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={beds}
            onChange={(e) => setBeds(e.target.value)}
            placeholder="e.g. 3"
            className="mt-1 w-full border rounded px-3 py-2.5 text-base bg-white dark:bg-slate-900"
          />
        </label>
        <label className="block text-sm">
          Bathrooms
          <input
            name="bathrooms"
            type="number"
            min={0}
            step={0.5}
            inputMode="decimal"
            value={baths}
            onChange={(e) => setBaths(e.target.value)}
            placeholder="e.g. 2.5"
            className="mt-1 w-full border rounded px-3 py-2.5 text-base bg-white dark:bg-slate-900"
          />
        </label>
      </div>

      {/* Info chips */}
      {(typeLabel || statusLabel) && (
        <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
          {typeLabel && (
            <span className="bg-slate-200 dark:bg-slate-700/60 rounded px-2 py-0.5">
              {typeLabel}
            </span>
          )}
          {statusLabel && (
            <span className="bg-slate-200 dark:bg-slate-700/60 rounded px-2 py-0.5">
              {statusLabel}
            </span>
          )}
        </div>
      )}

      {/* Photo + Zillow link */}
      {(photos.length > 0 || zillowUrl) && (
        <div className="space-y-2">
          {photos.length > 0 && (
            <div className="rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photos[0]}
                alt="Property"
                className="w-full h-48 sm:h-56 object-cover"
              />
            </div>
          )}
          {zillowUrl && (
            <a
              href={zillowUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              View photos &amp; details on Zillow →
            </a>
          )}
        </div>
      )}
    </fieldset>
  );
}
