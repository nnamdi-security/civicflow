"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";
import { Button } from "./button";
import type { LonLat } from "./map-picker";

// Leaflet touches `window`, so it is client-only (.claude/rules/ui.md).
const MapPicker = dynamic(() => import("./map-picker"), {
  ssr: false,
  loading: () => (
    <div role="status" className="flex h-72 items-center justify-center rounded-md border border-current">
      Loading map…
    </div>
  ),
});

interface LocationFieldProps {
  value: LonLat | null;
  onChange: (point: LonLat) => void;
  error?: string;
}

type GeoState = "idle" | "locating" | "denied" | "unsupported";

const format = (n: number) => n.toFixed(6);

export function LocationField({ value, onChange, error }: LocationFieldProps) {
  const id = useId();
  // What the user is typing, while they type. Otherwise the fields show the placed point, so
  // the map, the location button and the typed values never disagree.
  const [draft, setDraft] = useState<{ lat: string; lon: string } | null>(null);
  const [geo, setGeo] = useState<GeoState>("idle");
  const latText = draft?.lat ?? (value ? format(value.lat) : "");
  const lonText = draft?.lon ?? (value ? format(value.lon) : "");

  function place(point: LonLat) {
    setDraft(null);
    onChange(point);
  }

  function type(next: { lat: string; lon: string }) {
    setDraft(next);
    const lat = Number(next.lat);
    const lon = Number(next.lon);
    if (next.lat.trim() !== "" && next.lon.trim() !== "" && Number.isFinite(lat) && Number.isFinite(lon)) {
      onChange({ lat, lon });
    }
  }

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setGeo("unsupported");
      return;
    }
    setGeo("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeo("idle");
        place({ lon: position.coords.longitude, lat: position.coords.latitude });
      },
      () => setGeo("denied"),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  const inputClass =
    "min-h-11 w-full rounded-md border border-current bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2";

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="font-medium">Location of the problem</legend>
      <p id={`${id}-help`}>
        Tap the map to drop a pin, drag the pin to adjust it, or use your current location.
      </p>

      <MapPicker value={value} onChange={place} />

      <div className="flex flex-col gap-2">
        <Button type="button" onClick={useMyLocation} disabled={geo === "locating"}>
          {geo === "locating" ? "Finding your location…" : "Use my current location"}
        </Button>
        {geo === "denied" ? (
          <p role="status">
            We could not get your location. Tap the map or type the coordinates below.
          </p>
        ) : null}
        {geo === "unsupported" ? (
          <p role="status">Your browser cannot share its location. Tap the map instead.</p>
        ) : null}
      </div>

      <details>
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Type coordinates instead</summary>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-lat`}>Latitude</label>
            <input
              id={`${id}-lat`}
              inputMode="decimal"
              className={inputClass}
              value={latText}
              onChange={(e) => type({ lat: e.target.value, lon: lonText })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-lon`}>Longitude</label>
            <input
              id={`${id}-lon`}
              inputMode="decimal"
              className={inputClass}
              value={lonText}
              onChange={(e) => type({ lat: latText, lon: e.target.value })}
            />
          </div>
        </div>
      </details>

      <p aria-live="polite">
        {value
          ? `Pin placed at ${format(value.lat)}, ${format(value.lon)}.`
          : "No pin placed yet."}
      </p>
      {error ? (
        <p id={`${id}-error`} role="alert">
          Error: {error}
        </p>
      ) : null}
    </fieldset>
  );
}
