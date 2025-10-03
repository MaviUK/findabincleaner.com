// MiniSponsorshipMap.tsx
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import type { FeatureCollection } from "geojson";

// You can swap TileLayer for a blank tile if you want a super-minimal mini-map.
export default function MiniSponsorshipMap({ cleanerId }: { cleanerId: string }) {
  const [coverage, setCoverage] = useState<FeatureCollection | null>(null);
  const [wins, setWins] = useState<FeatureCollection | null>(null);
  const [available, setAvailable] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    (async () => {
      // 1) My coverage (union of service_areas for me)
      const cov = await fetch(`/api/geo/my-coverage?me=${cleanerId}`).then(r => r.json());
      setCoverage(cov);

      // 2) I’m #1 (filter sponsored_win_regions to me)
      const w = await fetch(`/api/geo/my-wins?slot=1&me=${cleanerId}`).then(r => r.json());
      setWins(w);

      // 3) Available for #1 inside my coverage
      const avail = await fetch(`/api/geo/available?slot=1&me=${cleanerId}`).then(r => r.json());
      setAvailable(avail);
    })();
  }, [cleanerId]);

  // Pick a sensible default view; or compute bounds from coverage once loaded.
  return (
    <div className="relative rounded-xl overflow-hidden border border-neutral-200">
      <MapContainer
        style={{ height: 260 }}
        zoom={11}
        center={[54.664, -5.67]} // e.g., Bangor approx; replace with dynamic centroid
        scrollWheelZoom={false}
        attributionControl={false}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {/* Layer A: My Coverage (outline only) */}
        {coverage && (
          <GeoJSON
            data={coverage}
            style={{ weight: 1.5, opacity: 1, color: "#222", fillOpacity: 0 }}
          />
        )}

        {/* Layer B: I’m #1 now (solid fill) */}
        {wins && (
          <GeoJSON
            data={wins}
            style={{ weight: 2, color: "#1d4ed8", fillOpacity: 0.22 }}
          />
        )}

        {/* Layer C: Available for #1 (dashed/hatched look) */}
        {available && (
          <GeoJSON
            data={available}
            style={{ weight: 2, color: "#16a34a", dashArray: "6,6", fillOpacity: 0.12 }}
          />
        )}
      </MapContainer>

      {/* Simple legend / toggles */}
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
