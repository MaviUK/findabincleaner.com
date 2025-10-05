// src/components/MiniSponsorshipMap.tsx
import { useEffect, useRef, useState, useMemo } from "react";
import {
  MapContainer as RLMapContainer,
  TileLayer,
  GeoJSON as RLGeoJSON,
} from "react-leaflet";

const MapAny = RLMapContainer as any;
const GeoJSONAny = RLGeoJSON as any;

type FC = GeoJSON.FeatureCollection;

const TILE_PROVIDERS = [
  // 1) Carto (fast + reliable)
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  // 2) OSM France HOT (fallback)
  "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
  // 3) Stamen Toner Lite (fallback)
  "https://stamen-tiles.a.ssl.fastly.net/toner-lite/{z}/{x}/{y}.png",
];

export default function MiniSponsorshipMap({ cleanerId }: { cleanerId: string }) {
  const [meFc, setMeFc] = useState<FC | null>(null);
  const [winsFc, setWinsFc] = useState<FC | null>(null);
  const [availFc, setAvailFc] = useState<FC | null>(null);
  const [tileIdx, setTileIdx] = useState(0);
  const mapRef = useRef<any | null>(null);

  const DEFAULT_CENTER: [number, number] = [54.664, -5.67];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = cleanerId;
        const [a, b, c] = await Promise.all([
          fetch(`/api/geo/my-coverage?me=${me}`),
          fetch(`/api/geo/my-wins?slot=1&me=${me}`),
          fetch(`/api/geo/available?slot=1&me=${me}`),
        ]);
        const [fa, fb, fc] = (await Promise.all([a.json(), b.json(), c.json()])) as [FC, FC, FC];
        if (!cancelled) {
          setMeFc(fa);
          setWinsFc(fb);
          setAvailFc(fc);
        }
      } catch {
        // ignore; map still renders
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [cleanerId]);

  // nudge Leaflet sizing after mount
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 300);
    return () => clearTimeout(t);
  }, []);

  // simple style helpers via onEachFeature (avoids TS prop mismatch)
  const onEachCoverage = (_: any, layer: any) =>
    layer.setStyle({ weight: 1, color: "#111827", fillOpacity: 0.05 });
  const onEachWins = (_: any, layer: any) =>
    layer.setStyle({ weight: 2, color: "#1d4ed8", fillOpacity: 0.15 });
  const onEachAvail = (_: any, layer: any) =>
    layer.setStyle({ weight: 2, color: "#059669", dashArray: "4,4", fillOpacity: 0.08 });

  // change key when provider changes so TileLayer remounts
  const tileUrl = useMemo(() => TILE_PROVIDERS[tileIdx % TILE_PROVIDERS.length], [tileIdx]);

  return (
    <div className="relative">
      <MapAny
        style={{ height: 260, width: "100%" }}
        whenCreated={(map: any) => {
          mapRef.current = map;
          map.setView(DEFAULT_CENTER, 11);
          setTimeout(() => map.invalidateSize(), 400);
        }}
        scrollWheelZoom={false}
        attributionControl={false}
        zoomControl={false}
      >
        <TileLayer
          key={tileUrl}
          url={tileUrl + (tileUrl.includes("?") ? "&" : "?") + "v=1"} // cache-bust
          // if a tile errors (blocked/rate-limited), rotate to next provider
          eventHandlers={{
            tileerror: () => setTileIdx((i) => i + 1),
          }}
        />

        {meFc && <GeoJSONAny data={meFc} onEachFeature={onEachCoverage} />}
        {winsFc && <GeoJSONAny data={winsFc} onEachFeature={onEachWins} />}
        {availFc && <GeoJSONAny data={availFc} onEachFeature={onEachAvail} />}
      </MapAny>
    </div>
  );
}
