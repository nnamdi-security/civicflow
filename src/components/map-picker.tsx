"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

export interface LonLat {
  lon: number;
  lat: number;
}

interface MapPickerProps {
  value: LonLat | null;
  onChange: (point: LonLat) => void;
}

// Default view: Nigeria (docs/integrations.md). Leaflet takes [lat, lon].
const NIGERIA_CENTER: [number, number] = [9.08, 8.68];
const NIGERIA_ZOOM = 6;
const PICKED_ZOOM = 16;

// A divIcon avoids Leaflet's default marker images, which bundlers do not resolve.
const pinIcon = L.divIcon({
  className: "",
  html: '<svg width="32" height="42" viewBox="0 0 32 42" aria-hidden="true"><path d="M16 0C7.2 0 0 7 0 15.7 0 27 16 42 16 42s16-15 16-26.3C32 7 24.8 0 16 0z" fill="#b91c1c" stroke="#ffffff" stroke-width="2"/><circle cx="16" cy="15.5" r="5.5" fill="#ffffff"/></svg>',
  iconSize: [32, 42],
  iconAnchor: [16, 42],
});

function ClickToPlace({ onChange }: { onChange: (point: LonLat) => void }) {
  useMapEvents({
    click(event) {
      onChange({ lon: event.latlng.lng, lat: event.latlng.lat });
    },
  });
  return null;
}

/** Moves the view when the point changes from outside the map (location button, typed values). */
function FollowValue({ value }: { value: LonLat | null }) {
  const map = useMap();
  useEffect(() => {
    if (value) map.setView([value.lat, value.lon], Math.max(map.getZoom(), PICKED_ZOOM));
  }, [map, value]);
  return null;
}

export default function MapPicker({ value, onChange }: MapPickerProps) {
  return (
    <div className="isolate">
      <MapContainer
        center={NIGERIA_CENTER}
        zoom={NIGERIA_ZOOM}
        className="h-72 w-full rounded-md border border-current"
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <ClickToPlace onChange={onChange} />
        <FollowValue value={value} />
        {value ? (
          <Marker
            position={[value.lat, value.lon]}
            icon={pinIcon}
            draggable
            eventHandlers={{
              dragend(event) {
                const { lat, lng } = (event.target as L.Marker).getLatLng();
                onChange({ lon: lng, lat });
              },
            }}
          />
        ) : null}
      </MapContainer>
    </div>
  );
}
