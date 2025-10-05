// src/components/AreaSponsorModal.tsx
import { useEffect, useMemo, useState } from "react";
import {
  MapContainer as RLMapContainer,
  TileLayer,
  Polygon as RLPolygon,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";

const MapAny = RLMapContainer as any;
const PolygonAny = RLPolygon as any;

type AvailableResp =
  | { ok: true; existing: any; available: any } // GeoJSONs
  | { error: string };

type PreviewResp =
  | { ok: true; area_km2: number; monthly_price: number; total_price: number; final_geojson: any | null }
  | { error: string };

export default function AreaSponsorModal({
  open,
  onClose,
  cleanerId,
  areaId,
  slot,
}: {
  open: boolean;
  onClose: () => void;
  cleanerId: string;
  areaId: string;
  slot: 1 | 2 | 3;
}) {
  const [avail, setAvail] = useState<AvailableResp | null>(null);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default view somewhere safe; we’ll auto-fit once avail loads (optional)
  const DEFAULT_CENTER: [number, number] = [54.664, -5.67];

  useEffect(() => {
    if (!open) return;
    setAvail(null);
    setPreview(null);
    setPoints([]);
    setError(null);

    (async () => {
      try {
        const r = await fetch(`/api/area/availability?area_id=${encodeURIComponent(areaId)}&slot=${slot}`);
        const data = (await r.json()) as AvailableResp;
        if (!r.ok || (data as any)?.error) throw new Error((data as any)?.error || "Failed to load availability");
        setAvail(data);
      } catch (e: any) {
        setError(e?.message || "Failed to load availability");
      }
    })();
  }, [open, areaId, slot]);

  // drawing helpers
  const isValid = points.length >= 3;
  const polygonLatLngs = useMemo<LatLngExpression[]>(() => points.map(([lat, lng]) => [lat, lng]) as LatLngExpression[], [points]);
  function buildDrawnGeoJSON() {
    const ring = points.map(([lat, lng]) => [lng, lat]);
    if (ring.length > 0) ring.push(ring[0]);
    return { type: "Polygon", coordinates: [ring] } as const;
  }

  // live preview when points change
  useEffect(() => {
    let cancelled = false;
    if (!open || !isValid) {
      setPreview(null);
      return;
    }
    (async () => {
      try {
        const body = {
          cleanerId,
          areaId,
          slot,
          months: 1,
          drawnGeoJSON: buildDrawnGeoJSON(),
        };
        const r = await fetch("/api/area/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await r.json()) as PreviewResp;
        if (!r.ok || (data as any)?.error) throw new Error((data as any)?.error || "Preview failed");
        if (!cancelled) setPreview(data);
      } catch (e: any) {
        if (!cancelled) setPreview(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, points, cleanerId, areaId, slot, isValid]);

  async function handleCheckout() {
    setBusy(true);
    setError(null);
    try {
      // Supabase JWT (if you want to lock this down server-side)
      const raw = localStorage.getItem("supabase.auth.token");
      let token: string | null = null;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          token = parsed?.currentSession?.access_token ?? null;
        } catch {}
      }

      const body = {
        cleanerId,
        areaId,
        slot,
        months: 1,
        drawnGeoJSON: buildDrawnGeoJSON(),
      };
      const r = await fetch("/api/area/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok || !data?.url) throw new Error(data?.error || "Failed to create checkout session");
      window.location.href = data.url; // Stripe Checkout
    } catch (e: any) {
      setError(e?.message || "Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const billableZero = !!preview && "ok" in preview && (preview.area_km2 === 0 || preview.monthly_price === 0);

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">Sponsor #{slot}</h3>
          <button className="text-sm px-2 py-1 rounded hover:bg-black/5" onClick={() => !busy && onClose()}>
            Close
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[80vh] overflow-auto">
          {!avail ? (
            <p className="text-sm text-gray-600">Loading availability…</p>
          ) : "error" in avail ? (
            <p className="text-sm text-red-600">{avail.error}</p>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Click the map to draw a shape <em>inside the green area</em> where you want to sponsor #{slot}.
                Use <strong>Undo</strong> / <strong>Clear</strong>. When happy, click <strong>Purchase</strong>.
              </p>

              <div className="rounded-xl overflow-hidden border">
                <MapAny
                  style={{ height: 340 }}
                  whenCreated={(map: any) => map.setView([54.664, -5.67], 11)}
                  scrollWheelZoom
                  attributionControl={false}
                  zoomControl
                  onclick={(e: any) => {
                    const { lat, lng } = e.latlng;
                    setPoints((prev) => [...prev, [lat, lng]]);
                  }}
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {/* Available area (green) */}
                  {avail.available?.coordinates && (
                    <PolygonAny
                      positions={
                        (avail.available.coordinates[0] as any[]).map(([lng, lat]: number[]) => [lat, lng])
                      }
                      pathOptions={{ color: "#16a34a", weight: 2, fillOpacity: 0.15 }}
                    />
                  )}
                  {/* User drawing (blue) */}
                  {points.length > 0 && (
                    <PolygonAny
                      positions={polygonLatLngs}
                      pathOptions={{ color: "#1d4ed8", weight: 2, fillOpacity: 0.2 }}
                    />
                  )}
                </MapAny>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-gray-500">Points: {points.length} {points.length >= 3 ? "(ok)" : "(need 3+)"}</div>
                {preview && "ok" in preview && (
                  <div className="text-sm">
                    <span className="mr-4">Area: {preview.area_km2.toFixed(4)} km²</span>
                    <span>Monthly: £{preview.monthly_price.toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <button className="px-3 py-1.5 rounded border" disabled={points.length === 0 || busy} onClick={() => setPoints((p) => p.slice(0, -1))}>
                  Undo
                </button>
                <button className="px-3 py-1.5 rounded border" disabled={points.length === 0 || busy} onClick={() => setPoints([])}>
                  Clear
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || points.length < 3 || billableZero}
                  title={billableZero ? "No billable area in this shape." : undefined}
                  onClick={handleCheckout}
                >
                  {busy ? "Creating checkout…" : "Purchase"}
                </button>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
