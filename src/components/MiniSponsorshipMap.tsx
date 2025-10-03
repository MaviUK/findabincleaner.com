import { useEffect, useState } from "react";
import {
  MapContainer as RLMapContainer,
  TileLayer,
  GeoJSON as RLGeoJSON,
} from "react-leaflet";
import type { FeatureCollection, Geometry } from "geojson";
import type { PathOptions } from "leaflet";

// ---- styles
const outline: PathOptions = { weight: 1.5, opacity: 1, color: "#222", fillOpacity: 0 };
const winStyle: PathOptions = { weight: 2, color: "#1d4ed8", fillOpacity: 0.22 };
const availStyle: PathOptions = { weight: 2, color: "#16a34a", dashArray: "6,6", fillOpacity: 0.12 };

// ---- map defaults
const DEFAULT_CENTER: [number, number] = [54.664, -5.67];
const DEFAULT_ZOOM = 11;

// Cast the RL components to any to avoid TS prop mismatches in your env
const MapAny = RLMapContainer as any;
const GeoJSONAny = RLGeoJSON as any;

export default function MiniSponsorshipMap({ cleanerId }: { cleanerId: string }) {
  const [coverage, setCoverage] = useState<FeatureCollection<Geometry> | null>(null);
  const [wins, setWins] = useState<FeatureCollection<Geometry> | null>(null);
  const [available, setAvailable] = useState<FeatureCollection<Geometry> | null>(null);

  useEffect(() => {
    (async () => {
      const [cov, w, av] = await Promise.all([
        fetch(`/api/geo/my-coverage?me=${cleanerId}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/geo/my-wins?slot=1&me=${cleanerId}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/geo/available?slot=1&me=${cleanerId}`).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (cov) setCoverage(cov);
      if (w) setWins(w);
      if (av) setAvailable(av);
    })();
  }, [cleanerId]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-neutral-200">
      <MapAny
        style={{ height: 260 }}
        whenCreated={(map: any) => map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)}
        scrollWheelZoom={false}
        attributionControl={false}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {coverage && <GeoJSONAny data={coverage} style={outline} />}
        {wins && <GeoJSONAny data={wins} style={winStyle} />}
        {available && <GeoJSONAny data={available} style={availStyle} />}
      </MapAny>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 bg-white/90 rounded-md shadow px-3 py-2 text-xs space-y-1">
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 border border-[#222]" />
          <span>My coverage</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 bg-[#1d4ed8]/30 border border-[#1d4ed8]" />
          <span>I’m #1 now</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 border-2 border-dashed border-[#16a34a]" />
          <span>Available for #1</span>
        </div>
      </div>
    </div>
  );
}
