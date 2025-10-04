// src/components/BuyFirstSpotModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer as RLMapContainer,
  TileLayer,
  Polygon as RLPolygon,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";

const MapAny = RLMapContainer as any;
const PolygonAny = RLPolygon as any;

type PreviewResult =
  | {
      ok: true;
      area_km2: number;
      monthly_price: number;
      total_price: number;
      final_geojson: any | null;
    }
  | { error: string };

export default function BuyFirstSpotModal({
  open,
  onClose,
  cleanerId,
}: {
  open: boolean;
  onClose: () => void;
  cleanerId: string;
}) {
  const [points, setPoints] = useState<[number, number][]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // live preview state
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Leaflet map instance (for invalidateSize fix)
  const mapRef = useRef<any | null>(null);

  // Bangor-ish default; replace with your centroid if you like
  const DEFAULT_CENTER: [number, number] = [54.664, -5.67];

  // reset on close
  useEffect(() => {
    if (!open) {
      setPoints([]);
      setError(null);
      setPreview(null);
      setSubmitting(false);
    }
  }, [open]);

  // ensure Leaflet recalculates size when modal opens / window resizes
  useEffect(() => {
    if (!open) return;
    const tick = () => {
      if (mapRef.current) mapRef.current.invalidateSize();
    };
    const t1 = setTimeout(tick, 300);
    window.addEventListener("resize", tick);
    return () => {
      clearTimeout(t1);
      window.removeEventListener("resize", tick);
    };
  }, [open]);

  const isPolygonValid = points.length >= 3;

  const polygonLatLngs = useMemo<LatLngExpression[]>(() => {
    return points.map(([lat, lng]) => [lat, lng]) as LatLngExpression[];
  }, [points]);

  function buildGeoJSON() {
    const ring = points.map(([lat, lng]) => [lng, lat]);
    if (ring.length > 0) ring.push(ring[0]);
    return { type: "Polygon", coordinates: [ring] } as const;
  }

  // live price preview as user draws
  useEffect(() => {
    let cancelled = false;

    async function runPreview() {
      if (!open || points.length < 3) {
        setPreview(null);
        return;
      }
      setPreviewing(true);
      try {
        const drawnGeoJSON = buildGeoJSON();
        const res = await fetch("/api/sponsored/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cleanerId, drawnGeoJSON, months: 1 }),
        });
        const data = (await res.json()) as PreviewResult;
        if (!res.ok || (data as any)?.error) {
          throw new Error((data as any)?.error || "Preview failed");
        }
        if (!cancelled) setPreview(data);
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }

    runPreview();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, open, cleanerId]);

  async function handlePurchase() {
    setSubmitting(true);
    setError(null);
    try {
      const drawnGeoJSON = buildGeoJSON();

      // Start Stripe Checkout (server computes final price + creates session)
      const res = await fetch("/api/sponsored/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cleanerId, drawnGeoJSON, months: 1 }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || "Failed to start checkout.");
      }
      // Redirect to Stripe
      window.location.href = data.url;
    } catch (e: any) {
      setError(e?.message || "Failed to start checkout.");
      setSubmitting(false);
    }
  }

  if (!open) return null;

  const billableZero =
    !preview || (preview as any)?.area_km2 === 0 || (preview as any)?.monthly_price === 0;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => {
          if (!submitting) onClose();
        }}
      />

      {/* modal */}
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">Buy First Spot (#1)</h3>
          <button
            className="text-sm px-2 py-1 rounded hover:bg-black/5"
            onClick={() => !submitting && onClose()}
          >
            Close
          </button>
        </div>

        {/* body */}
        <div className="p-4 space-y-4 max-h-[80vh] overflow-auto">
          <p className="text-sm text-gray-600">
            Draw a shape inside your coverage where you want to buy the <strong>#1</strong> spot.
            Click to add points. Use <strong>Undo</strong> to remove the last point. When you’re
            happy, click <strong>Purchase</strong>.
          </p>

          {/* map */}
          <div className="relative rounded-xl overflow-hidden border">
            <MapAny
              style={{ height: 320 }}
              whenCreated={(map: any) => {
                mapRef.current = map;
                map.setView(DEFAULT_CENTER, 11);
                setTimeout(() => map.invalidateSize(), 300);
              }}
              scrollWheelZoom
              attributionControl={false}
              zoomControl
              onClick={(e: any) => {
                const { lat, lng } = e.latlng;
                setPoints((prev) => [...prev, [lat, lng]]);
              }}
            >
              {/* Carto tiles (robust) — no attribution prop to satisfy TS */}
              <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />

              {points.length > 0 && (
                <PolygonAny
                  positions={polygonLatLngs}
                  pathOptions={{ color: "#1d4ed8", weight: 2, fillOpacity: 0.2 }}
                />
              )}
            </MapAny>
          </div>

          {/* controls + preview */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-gray-500">
              Points: {points.length} {isPolygonValid ? "(ok)" : "(need 3+)"}
              {previewing && <span className="ml-2">calculating…</span>}
            </div>

            {preview && "ok" in preview && (
              <div className="text-sm">
                <span className="mr-4">
                  Area: {(preview.area_km2 ?? 0).toFixed(4)} km²
                </span>
                <span>Monthly: £{(preview.monthly_price ?? 0).toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* action buttons */}
          <div className="flex items-center gap-2 justify-end">
            <button
              className="px-3 py-1.5 rounded border"
              onClick={() => setPoints((p) => p.slice(0, -1))}
              disabled={points.length === 0 || submitting}
            >
              Undo
            </button>
            <button
              className="px-3 py-1.5 rounded border"
              onClick={() => setPoints([])}
              disabled={points.length === 0 || submitting}
            >
              Clear
            </button>
            <button
              className="btn btn-primary"
              disabled={!isPolygonValid || submitting || billableZero}
              onClick={handlePurchase}
              title={
                billableZero
                  ? "No billable area in this shape (overlaps someone else's #1)."
                  : undefined
              }
            >
              {submitting ? "Redirecting…" : "Purchase"}
            </button>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <p className="text-xs text-gray-500">
            You’ll be redirected to Stripe to pay. We only charge for the part of your shape that’s
            actually available for #1.
          </p>
        </div>
      </div>
    </div>
  );
}
