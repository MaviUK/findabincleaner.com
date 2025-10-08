import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer as RLMapContainer,
  TileLayer,
  GeoJSON as RLGeoJSON,
} from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";

const MapAny = RLMapContainer as any;
const GeoJSONAny = RLGeoJSON as any;

type AvailabilityResponse = {
  ok: boolean;
  existing: any;   // GeoJSON (MultiPolygon)
  available: any;  // GeoJSON (Polygon | MultiPolygon | null)
};

type PreviewResponse =
  | {
      ok: true;
      area_km2: number;
      monthly_price: number;
      total_price: number;
      final_geojson: any | null;
    }
  | { error: string };

export default function AreaSponsorDrawer({
  open,
  onClose,
  areaId,
  slot,
  center,
}: {
  open: boolean;
  onClose: () => void;
  areaId: string;
  slot: 1 | 2 | 3;
  center: [number, number];
}) {
  const mapRef = useRef<LeafletMap | null>(null);

  // data
  const [avail, setAvail] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // pricing preview (for “full available” to start with)
  const [months, setMonths] = useState<number>(1);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!open) {
      setAvail(null);
      setPreview(null);
      setErr(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // 1) fetch availability for this area + slot
        const q = new URLSearchParams({ area_id: areaId, slot: String(slot) });
        const r1 = await fetch(`/api/area/availability?${q.toString()}`);
        const data1 = (await r1.json()) as AvailabilityResponse;
        if (!r1.ok || !data1?.ok) throw new Error("Failed to load availability");
        if (cancelled) return;
        setAvail(data1);

        // Fit bounds if we have an available polygon
        setTimeout(() => {
          try {
            if (!mapRef.current) return;
            const L = (window as any).L;
            const collection = data1.available || data1.existing;
            if (collection && L) {
              const layer = L.geoJSON(collection);
              const b = layer.getBounds();
              if (b && b.isValid()) {
                mapRef.current!.fitBounds(b.pad(0.1));
              }
            }
          } catch {}
        }, 50);

        // 2) price preview for the full available shape
        setPreviewing(true);
        const r2 = await fetch("/api/area/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            areaId,
            slot,
            months,
            // no drawnGeoJSON -> preview “full available”
          }),
        });
        const data2 = (await r2.json()) as PreviewResponse;
        if (!r2.ok || (data2 as any)?.error) {
          // still show the map; just no price
          if (!cancelled) setPreview({ error: (data2 as any)?.error || "Preview failed" });
        } else {
          if (!cancelled) setPreview(data2);
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load");
      } finally {
        if (!cancelled) {
          setLoading(false);
          setPreviewing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, areaId, slot, months]);

  const billableZero =
    !preview ||
    "error" in preview ||
    (preview as any)?.area_km2 === 0 ||
    (preview as any)?.monthly_price === 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center p-4">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onClose()}
      />

      {/* panel */}
      <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">
            Sponsor spot #{slot}
          </h3>
          <button
            className="text-sm px-2 py-1 rounded hover:bg-black/5"
            onClick={() => onClose()}
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-4">
          {err && (
            <div className="text-sm text-red-600">{err}</div>
          )}

          {/* Map */}
          <div className="rounded-xl overflow-hidden border">
            <MapAny
              style={{ height: 360 }}
              whenCreated={(m: LeafletMap) => {
                mapRef.current = m;
                m.setView(center, 12);
              }}
              scrollWheelZoom
              attributionControl={false}
              zoomControl
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {avail?.existing && (
                <GeoJSONAny
                  data={avail.existing}
                  style={{ color: "#7c3aed", weight: 2, fillOpacity: 0.05 }}
                />
              )}
              {avail?.available && (
                <GeoJSONAny
                  data={avail.available}
                  style={{ color: "#16a34a", weight: 2, fillOpacity: 0.15 }}
                />
              )}
            </MapAny>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <label className="mr-2">Months</label>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={months}
                onChange={(e) => setMonths(parseInt(e.target.value, 10) || 1)}
              >
                <option value={1}>1</option>
                <option value={3}>3</option>
                <option value={6}>6</option>
                <option value={12}>12</option>
              </select>
            </div>

            <div className="text-sm">
              {previewing && <span className="text-gray-500">Calculating…</span>}
              {!previewing && preview && "ok" in preview && (
                <>
                  <span className="mr-4">
                    Area: {preview.area_km2.toFixed(4)} km²
                  </span>
                  <span className="mr-2">
                    Monthly: £{preview.monthly_price.toFixed(2)}
                  </span>
                  <span className="font-medium">
                    Total: £{preview.total_price.toFixed(2)}
                  </span>
                </>
              )}
              {!previewing && preview && "error" in preview && (
                <span className="text-red-600">{preview.error}</span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2">
            <button
              className="px-3 py-1.5 rounded border"
              onClick={() => onClose()}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={billableZero}
              onClick={() => {
                // NEXT STEP: wire this to Stripe checkout
                // For now, just confirm we can compute price.
                alert("Looks good! Next step is checkout.");
              }}
              title={
                billableZero
                  ? "No billable area available for this slot."
                  : undefined
              }
            >
              Continue to Checkout
            </button>
          </div>

          {loading && (
            <div className="text-xs text-gray-500">Loading…</div>
          )}
          <p className="text-xs text-gray-500">
            Note: You’ll only be charged for the portion of your area that’s
            actually available for this spot.
          </p>
        </div>
      </div>
    </div>
  );
}
