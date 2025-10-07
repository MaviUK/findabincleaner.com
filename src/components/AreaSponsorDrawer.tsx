// src/components/AreaSponsorDrawer.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Polygon, useJsApiLoader } from "@react-google-maps/api";

type AvailabilityOk = { ok: true; existing: any; available: any | null };
type AvailabilityErr = { ok: false; error: string };
type AvailabilityResponse = AvailabilityOk | AvailabilityErr;

type PreviewOk = {
  ok: true;
  area_km2: number | string;
  monthly_price: number | string;
  total_price: number | string;
  final_geojson: any | null;
};
type PreviewErr = { ok: false; error: string };
type PreviewResponse = PreviewOk | PreviewErr;

function toNum(n: unknown): number | null {
  const x = typeof n === "string" ? Number(n) : (n as number);
  return Number.isFinite(x) ? (x as number) : null;
}

function isMultiPolygon(gj: any): gj is GeoJSON.MultiPolygon {
  return gj && gj.type === "MultiPolygon";
}
function isPolygon(gj: any): gj is GeoJSON.Polygon {
  return gj && gj.type === "Polygon";
}

/** Convert GeoJSON Polygon/MultiPolygon to array(s) of Google Map paths */
function gjToGooglePaths(
  gj: GeoJSON.Polygon | GeoJSON.MultiPolygon
): Array<Array<{ lat: number; lng: number }[]>> {
  const out: Array<Array<{ lat: number; lng: number }[]>> = [];
  if (isPolygon(gj)) {
    const rings = gj.coordinates;
    out.push(rings.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))));
  } else if (isMultiPolygon(gj)) {
    (gj.coordinates || []).forEach((poly) => {
      const rings = poly;
      out.push(rings.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))));
    });
  }
  return out;
}

const MAP_STYLE = { width: "100%", height: "360px" } as const;

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
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY as string,
    libraries: [],
  });

  const mapRef = useRef<google.maps.Map | null>(null);

  // data
  const [avail, setAvail] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // pricing preview
  const [months, setMonths] = useState<number>(1);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Build URLs (bypass SPA)
  const availabilityUrl = useMemo(() => {
    const qs = new URLSearchParams({
      area_id: areaId,
      slot: String(slot),
      t: String(Date.now()),
    });
    return `/.netlify/functions/area-availability?${qs.toString()}`;
  }, [areaId, slot]);

  // Load availability + initial preview
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
        // 1) Availability
        const r1 = await fetch(availabilityUrl, {
          method: "GET",
          headers: { accept: "application/json" },
        });
        const ct1 = r1.headers.get("content-type") || "";
        const raw1 = await r1.text().catch(() => "");
        if (!r1.ok) throw new Error(`HTTP ${r1.status}\n${raw1}`);
        if (!ct1.includes("application/json")) throw new Error("Non-JSON availability response.");
        const data1: AvailabilityResponse = JSON.parse(raw1);
        if (!data1?.ok) throw new Error((data1 as AvailabilityErr)?.error || "Availability failed.");
        if (cancelled) return;
        setAvail(data1);

        // 2) Preview (full available)
        setPreviewing(true);
        const r2 = await fetch(`/.netlify/functions/area-preview`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            area_id: areaId,
            slot,
            months,
            // no drawnGeoJSON -> preview full available
          }),
        });
        const ct2 = r2.headers.get("content-type") || "";
        const raw2 = await r2.text().catch(() => "");
        if (!r2.ok) throw new Error(`HTTP ${r2.status}\n${raw2}`);
        if (!ct2.includes("application/json")) throw new Error("Non-JSON preview response.");
        const data2: PreviewResponse = JSON.parse(raw2);
        if (!data2?.ok) {
          setPreview({ ok: false, error: (data2 as PreviewErr).error || "Preview failed" });
        } else {
          setPreview(data2);
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
  }, [open, areaId, slot, months, availabilityUrl]);

  // Fit bounds when map & data ready
  useEffect(() => {
    if (!isLoaded || !mapRef.current || !avail || !avail.ok) return;
    const gmap = mapRef.current;
    const shape =
      (avail.available as GeoJSON.Polygon | GeoJSON.MultiPolygon) ||
      (avail.existing as GeoJSON.Polygon | GeoJSON.MultiPolygon);
    if (!shape) return;

    const bounds = new google.maps.LatLngBounds();
    const polys = gjToGooglePaths(shape);
    polys.forEach((rings) =>
      rings.forEach((ring) => ring.forEach((pt) => bounds.extend(new google.maps.LatLng(pt.lat, pt.lng))))
    );
    if (!bounds.isEmpty()) gmap.fitBounds(bounds, 40);
  }, [isLoaded, avail]);

  const billableZero =
    !preview ||
    !("ok" in preview && preview.ok) ||
    toNum((preview as PreviewOk).area_km2) === 0 ||
    toNum((preview as PreviewOk).monthly_price) === 0;

  if (!open) return null;

  const areaKm2 = preview && "ok" in preview && preview.ok ? toNum(preview.area_km2) : null;
  const monthly = preview && "ok" in preview && preview.ok ? toNum(preview.monthly_price) : null;
  const total = preview && "ok" in preview && preview.ok ? toNum(preview.total_price) : null;

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center p-4">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={() => onClose()} />

      {/* panel */}
      <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">Sponsor spot #{slot}</h3>
          <button className="text-sm px-2 py-1 rounded hover:bg-black/5" onClick={() => onClose()}>
            Close
          </button>
        </div>

        <div className="p-4 space-y-4">
          {err && <div className="text-sm text-red-600 whitespace-pre-wrap">{err}</div>}

          {/* Map */}
          <div className="rounded-xl overflow-hidden border">
            {loadError && <div className="p-4 text-sm text-red-600">Failed to load Google Maps SDK.</div>}
            {!isLoaded && !loadError && <div className="p-4 text-sm text-gray-600">Loading map…</div>}
            {isLoaded && (
              <GoogleMap
                mapContainerStyle={MAP_STYLE}
                center={{ lat: center[0], lng: center[1] }}
                zoom={12}
                options={{ mapTypeControl: false, streetViewControl: false }}
                onLoad={(m) => {
                  // IMPORTANT: do not return a value here (must be void)
                  mapRef.current = m;
                }}
              >
                {/* Existing (purple) */}
                {avail && avail.ok && avail.existing &&
                  gjToGooglePaths(avail.existing).map((rings, i) => (
                    <Polygon
                      key={`ex-${i}`}
                      paths={rings}
                      options={{
                        strokeColor: "#7c3aed",
                        strokeOpacity: 0.9,
                        strokeWeight: 2,
                        fillColor: "#7c3aed",
                        fillOpacity: 0.05,
                        clickable: false,
                      }}
                    />
                  ))}

                {/* Available (green) */}
                {avail && avail.ok && avail.available &&
                  gjToGooglePaths(avail.available).map((rings, i) => (
                    <Polygon
                      key={`av-${i}`}
                      paths={rings}
                      options={{
                        strokeColor: "#16a34a",
                        strokeOpacity: 0.9,
                        strokeWeight: 2,
                        fillColor: "#16a34a",
                        fillOpacity: 0.15,
                        clickable: false,
                      }}
                    />
                  ))}
              </GoogleMap>
            )}
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
              {!previewing && preview && "ok" in preview && preview.ok && (
                <>
                  <span className="mr-4">Area: {areaKm2 !== null ? areaKm2.toFixed(4) : "–"} km²</span>
                  <span className="mr-2">Monthly: £{monthly !== null ? monthly.toFixed(2) : "–"}</span>
                  <span className="font-medium">Total: £{total !== null ? total.toFixed(2) : "–"}</span>
                </>
              )}
              {!previewing && preview && "ok" in preview && !preview.ok && (
                <span className="text-red-600">{(preview as PreviewErr).error}</span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2">
            <button className="px-3 py-1.5 rounded border" onClick={() => onClose()}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={billableZero}
              onClick={() => {
                // Hook up to your checkout the same way as AreaSponsorModal when ready.
                alert("Looks good! Next step is checkout.");
              }}
              title={billableZero ? "No billable area available for this slot." : undefined}
            >
              Continue to Checkout
            </button>
          </div>

          {loading && <div className="text-xs text-gray-500">Loading…</div>}
          <p className="text-xs text-gray-500">
            Note: You’ll only be charged for the portion of your area that’s actually available for this spot.
          </p>
        </div>
      </div>
    </div>
  );
}
