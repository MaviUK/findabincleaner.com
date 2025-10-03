import { useEffect, useState } from "react";
import { MapContainer, TileLayer, GeoJSON as RLGeoJSON } from "react-leaflet";
import type { FeatureCollection, Geometry } from "geojson";
import type { PathOptions } from "leaflet";

// Small, safe styles
const outline: PathOptions = { weight: 1.5, opacity: 1, color: "#222", fillOpacity: 0 };
const winStyle: PathOptions = { weight: 2, color: "#1d4ed8", fillOpacity: 0.22 };
const availStyle: PathOptions = { weight: 2, color: "#16a34a", dashArray: "6,6", fillOpacity: 0.12 };

// Default view (you can make this dynamic later)
const DEFAULT_CENTER: [number, number] = [54.664, -5.67];
const DEFAULT_ZOOM = 11;

export default function MiniSponsorshipMap({ cleanerId }: { cleanerId: string }) {
  const [coverage, setCoverage] = useState<FeatureCollection<Geometry> | null>(null);
  const [wins, setWins] = useState<FeatureCollection<Geometry> | null>(null);
  const [available, setAvailable] = useState<FeatureCollection<Geometry> | null>(null);

  useEffect(() => {
    (async () => {
      // Swap these endpoints with your RPCs if you prefer
      const [cov, w, av] = await Promise.all([
        fetch(`/api/geo/my-coverage?me=${cleanerId}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/geo/my-wins?slot=1&me=${cleanerId}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/geo/available?slot=1&me=${cleanerId}`).then(r => r.ok ? r.json() : null),
      ]);
      if (cov) setCoverage(cov);
      if (w) setWins(w);
      if (av) setAvailable(av);
    })();
  }, [cleanerId]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-neutral-200">
      <MapContainer
        style={{ height: 260 }}
        center={DEFAULT_CENTER}
        // Some type sets don’t expose `zoom`; set initial view via whenCreated:
        whenCreated={(map) => map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)}
        scrollWheelZoom={false}
        attributionControl={false}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {/* Layer A: My Coverage (outline only) */}
        {coverage && (
          <RLGeoJSON
            data={coverage as any}
            onEachFeature={(_, layer) => layer.setStyle(outline)}
          />
        )}

        {/* Layer B: I’m #1 now (solid fill) */}
        {wins && (
          <RLGeoJSON
            data={wins as any}
            onEachFeature={(_, layer) => layer.setStyle(winStyle)}
          />
        )}

        {/* Layer C: Available for #1 (dashed/hatched) */}
        {available && (
          <RLGeoJSON
            data={available as any}
            onEachFeature={(_, layer) => layer.setStyle(availStyle)}
          />
        )}
      </MapContainer>

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
