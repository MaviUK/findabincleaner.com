// src/components/MiniSponsorshipMap.tsx
import { useEffect, useRef, useState } from "react";
import {
  MapContainer as RLMapContainer,
  TileLayer,
  GeoJSON as RLGeoJSON,
} from "react-leaflet";

// react-leaflet types are a bit strict on some props; casting keeps TS happy.
const MapAny = RLMapContainer as any;
const GeoJSONAny = RLGeoJSON as any;

type FC = GeoJSON.FeatureCollection;

export default function MiniSponsorshipMap({
  cleanerId,
}: {
  cleanerId: string;
}) {
  const [meFc, setMeFc] = useState<FC | null>(null);
  const [winsFc, setWinsFc] = useState<FC | null>(null);
  const [availFc, setAvailFc] = useState<FC | null>(null);
  const mapRef = useRef<any | null>(null);

  // Bangor-ish default. You can center to user's centroid if you have it.
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

        const [fa, fb, fc] = (await Promise.all([
          a.json(),
          b.json(),
          c.json(),
        ])) as [FC, FC, FC];

        if (!cancelled) {
          setMeFc(fa);
          setWinsFc(fb);
          setAvailFc(fc);
        }
      } catch {
        // swallow; component still renders base map
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [cleanerId]);

  // Nudge Leaflet to compute the correct size when first shown
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 300);
    return () => clearTimeout(t);
  }, []);

  // Small helpers to color layers without using the `style` prop (avoids older TS type errors)
  const styleCoverage = (_: any, layer: any) =>
    layer.setStyle({ weight: 1, color: "#111827", fillOpacity: 0.04 });
  const styleWins = (_: any, layer: any) =>
    layer.setStyle({ weight: 2, color: "#1d4ed8", fillOpacity: 0.15 });
  const styleAvail = (_: any, layer: any) =>
    layer.setStyle({
      weight: 2,
      color: "#059669",
      dashArray: "4,4",
      fillOpacity: 0.08,
    });

  return (
    <div className="relative">
      <MapAny
        style={{ height: 260, width: "100%" }}
        whenCreated={(map: any) => {
          mapRef.current = map;
          map.setView(DEFAULT_CENTER, 11);
          // extra tick to ensure tiles paint in hidden/just-mounted containers
          setTimeout(() => map.invalidateSize(), 400);
        }}
        scrollWheelZoom={false}
        attributionControl={false}
        zoomControl={false}
      >
        {/* Use a robust basemap (Carto light). You can swap to OSM if you prefer. */}
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />

        {meFc && (
          <GeoJSONAny data={meFc} onEachFeature={styleCoverage} />
        )}
        {winsFc && (
          <GeoJSONAny data={winsFc} onEachFeature={styleWins} />
        )}
        {availFc && (
          <GeoJSONAny data={availFc} onEachFeature={styleAvail} />
        )}
      </MapAny>
    </div>
  );
}
