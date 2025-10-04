// src/components/BuyFirstSpotModal.tsx
import { useEffect, useMemo, useState } from "react";
import {
  MapContainer as RLMapContainer,
  TileLayer,
  Polygon as RLPolygon,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";

const MapAny = RLMapContainer as any;
const PolygonAny = RLPolygon as any;

type PurchaseResult =
  | {
      ok: boolean;
      sponsorship_id: string;
      area_id: string;
      area_km2: number;
      monthly_price: number;
      total_price: number;
      final_geojson: any;
    }
  | { error: string };

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
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // live preview state
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Bangor-ish default; replace with your centroid if you like
  const DEFAULT_CENTER: [number, number] = [54.664, -5.67];

  useEffect(() => {
    if (!open) {
      setPoints([]);
      setResult(null);
      setError(null);
      setPreview(null);
      setSubmitting(false);
    }
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

  // --- live preview whenever points change ---
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

      // Grab the current Supabase JWT from localStorage (vite + supabase)
      const raw = localStorage.getItem("supabase.auth.token");
      let token: string | null = null;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          token = parsed?.currentSession?.access_token ?? null;
        } catch {}
      }

      const res = await fetch("/api/sponsored/purchase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          cleanerId,
          name: "Sponsored area – Slot #1",
          slot: 1,
          months: 1,
          drawnGeoJSON,
        }),
      });

      const data = (await res.json()) as PurchaseResult;
      if (!res.ok || (data as any)?.error) {
        throw new Error((data as any)?.error || "Failed to purchase.");
      }
      setResult(data);
    } catch (e: any) {
      setError(e?.message || "Failed to purchase.");
    } finally {
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
          {!result ? (
            <>
              <p className="text-sm text-gray-600">
                Draw a shape inside your coverage where you want to buy the <strong>#1</strong> spot.
                Click to add points. Use <strong>Undo</strong> to remove the last point. When you’re
                happy, click <strong>Purchase</strong>.
              </p>

              {/* map */}
              <div className="relative rounded-xl overflow-hidden border">
                <MapAny
                  style={{ height: 320 }}
                  whenCreated={(map: any) => map.setView(DEFAULT_CENTER, 11)}
                  scrollWheelZoom={true}
                  attributionControl={false}
                  zoomControl={true}
                  onClick={(e: any) => {
                    const { lat, lng } = e.latlng;
                    setPoints((prev) => [...prev, [lat, lng]]);
                  }}
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
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
                    <span>
                      Monthly: £{(preview.monthly_price ?? 0).toFixed(2)}
                    </span>
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
                  {submitting ? "Purchasing…" : "Purchase"}
                </button>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
              <p className="text-xs text-gray-500">
                We’ll only charge for the part of your shape that’s actually available for #1.
              </p>
            </>
          ) : (
            <>
              <h4 className="text-base font-semibold">Purchase complete</h4>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-gray-500">Sponsorship ID:</span>{" "}
                  <span className="font-mono">{(result as any).sponsorship_id}</span>
                </div>
                <div>
                  <span className="text-gray-500">Area:</span>{" "}
                  {(result as any).area_km2.toFixed(4)} km²
                </div>
                <div>
                  <span className="text-gray-500">Monthly price:</span> £
                  {(result as any).monthly_price.toFixed(2)}
                </div>
                <div>
                  <span className="text-gray-500">Charged (months x price):</span> £
                  {(result as any).total_price.toFixed(2)}
                </div>
              </div>
              <div className="pt-3">
                <button className="btn btn-primary" onClick={onClose}>
                  Done
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Your sponsored region will appear on the mini map shortly. If you don’t see it,
                refresh the page.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
