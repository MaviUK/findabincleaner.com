// src/components/AreaSponsorDrawer.tsx
import { useEffect, useMemo, useState } from "react";
import {
  MapContainer as RLMapContainer,
  TileLayer,
  GeoJSON as RLGeoJSON,
  Polygon as RLPolygon,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";

const MapAny = RLMapContainer as any;
const GeoJSONAny = RLGeoJSON as any;
const PolygonAny = RLPolygon as any;

type PreviewResult =
  | { ok: true; final_geojson: any; area_km2: number; monthly_price: number; total_price: number }
  | { error: string };

type Availability =
  | { ok: true; available: any; existing: any }
  | { error: string };

export default function AreaSponsorDrawer({
  open,
  onClose,
  areaId,
  slot,
  center, // [lat, lng] to centre the mini map around this area
}: {
  open: boolean;
  onClose: () => void;
  areaId: string;
  slot: 1 | 2 | 3;
  center: [number, number];
}) {
  const [avail, setAvail] = useState<Availability | null>(null);
  const [error, setError] = useState<string | null>(null);

  // drawing
  const [points, setPoints] = useState<[number, number][]>([]);
  const polyLatLngs = useMemo<LatLngExpression[]>(() => {
    return points.map(([lat, lng]) => [lat, lng]) as LatLngExpression[];
  }, [points]);

  // live preview
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Reset when open toggles
  useEffect(() => {
    if (!open) {
      setAvail(null);
      setError(null);
      setPoints([]);
      setPreview(null);
      setPreviewing(false);
    }
  }, [open]);

  // Load availability shapes
  useEffect(() => {
    if (!open) return;
    (async () => {
      setError(null);
      try {
        const res = await fetch(`/api/area/availability?area_id=${areaId}&slot=${slot}`);
        const data = (await res.json()) as Availability;
        if (!res.ok || (data as any)?.error) {
          throw new Error((data as any)?.error || "Failed to load availability");
        }
        setAvail(data);
      } catch (e: any) {
        setError(e?.message || "Failed to load availability");
      }
    })();
  }, [open, areaId, slot]);

  // Build drawn polygon GeoJSON
  const buildGeoJSON = () => {
    const ring = points.map(([lat, lng]) => [lng, lat]);
    if (ring.length > 0) ring.push(ring[0]);
    return { type: "Polygon", coordinates: [ring] } as const;
  };

  // Live preview whenever points change
  useEffect(() => {
    let cancelled = false;
    async function runPreview() {
      if (!open || points.length < 3) {
        setPreview(null);
        return;
      }
      setPreviewing(true);
      try {
        const res = await fetch("/api/area/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            area_id: areaId,
            slot,
            drawnGeoJSON: buildGeoJSON(),
          }),
        });
        const data = (await res.json()) as PreviewResult;
        if (!res.ok || (data as any)?.error) {
          throw new Error((data as any)?.error || "Preview failed");
        }
        if (!cancelled) setPreview(data);
      } catch (e: any) {
        if (!cancelled) setPreview({ error: e?.message || "Preview failed" });
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }
    runPreview();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, open, areaId, slot]);

  const isValid = points.length >= 3;
  const billableZero =
    !preview || (preview as any)?.area_km2 === 0 || (preview as any)?.monthly_price === 0;

  async function handlePurchase() {
    // Hook to Stripe in the next step
    alert("Purchase will go to Stripe in the next step. Preview first:\n" + JSON.stringify(preview, null, 2));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">Sponsor spot #{slot}</h3>
          <button className="text-sm px-2 py-1 rounded hover:bg-black/5" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          {error && <div className="text-sm text-red-600">{error}</div>}

          {/* Map */}
          <div className="rounded-xl overflow-hidden border">
            <MapAny
              style={{ height: 360 }}
              whenCreated={(map: any) => map.setView(center, 12)}
              scrollWheelZoom={true}
              attributionControl={false}
              zoomControl={true}
              onClick={(e: any) => {
                const { lat, lng } = e.latlng;
                setPoints((prev) => [...prev, [lat, lng]]);
              }}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

              {/* available (green) + existing (blue) */}
              {avail && "ok" in avail && avail.available && (
                <GeoJSONAny data={avail.available} style={{ color: "#16a34a", weight: 2, fillOpacity: 0.2 }} />
              )}
              {avail && "ok" in avail && avail.existing && (
                <GeoJSONAny data={avail.existing} style={{ color: "#2563eb", weight: 2, fillOpacity: 0.15 }} />
              )}

              {/* your drawn polygon */}
              {points.length > 0 && (
                <PolygonAny
                  positions={polyLatLngs}
                  pathOptions={{ color: "#1f2937", weight: 2, fillOpacity: 0.2 }}
                />
              )}
            </MapAny>
          </div>

          {/* Controls + preview */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="text-xs text-gray-600">
              Points: {points.length} {isValid ? "(ok)" : "(need 3+)"} {previewing && " • previewing…"}
            </div>
            {preview && "ok" in preview && (
              <div className="text-sm">
                Area: {(preview.area_km2 || 0).toFixed(4)} km² • Monthly: £{(preview.monthly_price || 0).toFixed(2)}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2">
            <button className="px-3 py-1.5 rounded border" onClick={() => setPoints((p) => p.slice(0, -1))} disabled={points.length === 0}>
              Undo
            </button>
            <button className="px-3 py-1.5 rounded border" onClick={() => setPoints([])} disabled={points.length === 0}>
              Clear
            </button>
            <button
              className="btn btn-primary"
              disabled={!isValid || billableZero}
              title={billableZero ? "No billable area in this shape." : undefined}
              onClick={handlePurchase}
            >
              Purchase
            </button>
          </div>

          <p className="text-xs text-gray-500">
            Tip: we’ll only charge for the part of your shape that’s actually available for spot #{slot}.
          </p>
        </div>
      </div>
    </div>
  );
}
