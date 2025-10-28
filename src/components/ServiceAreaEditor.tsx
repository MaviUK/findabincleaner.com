import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Polygon, DrawingManager, useJsApiLoader } from "@react-google-maps/api";
import { supabase } from "../lib/supabase";
import AreaSponsorModal from "./AreaSponsorModal";
import AreaManageModal from "./AreaManageModal";

/** ——— Types ——— */
export interface ServiceAreaRow {
  id: string;
  business_id: string;
  name: string;
  gj: any; // GeoJSON MultiPolygon
  created_at: string;
}

type Libraries = ("drawing" | "geometry")[];

/** ——— Helpers ——— */

// Compute signed ring area on a sphere using google.maps.geometry.spherical
function ringAreaMeters(path: Array<{ lat: number; lng: number }>): number {
  // outer ring positive, holes negative
  const arr = path.map((p) => new google.maps.LatLng(p.lat, p.lng));
  return Math.abs(google.maps.geometry.spherical.computeArea(arr));
}

function multiPolygonAreaMeters(multi: any): number {
  if (!multi || multi.type !== "MultiPolygon" || !Array.isArray(multi.coordinates)) return 0;
  let total = 0;
  (multi.coordinates as number[][][][]).forEach((poly) => {
    // poly: [ring][vertex][lng/lat]
    poly.forEach((ring, idx) => {
      const path = ring.map(([lng, lat]) => ({ lat, lng }));
      const a = ringAreaMeters(path);
      total += idx === 0 ? a : -a; // subtract holes
    });
  });
  return Math.max(0, total);
}

const MAP_CONTAINER = { width: "100%", height: "600px" } as const;
const DEFAULT_CENTER = { lat: 54.607868, lng: -5.926437 };
const DEFAULT_ZOOM = 11;

const basePoly: google.maps.PolygonOptions = {
  strokeWeight: 2,
  strokeOpacity: 0.9,
  fillOpacity: 0.35,
  clickable: true,
  editable: true,
  draggable: false,
};

const fmtKm2 = (m2: number) => (m2 / 1_000_000).toFixed(4);

/** ——— Component ——— */
export default function ServiceAreaEditor({
  cleanerId,
}: {
  cleanerId: string;
}) {
  const libraries = useMemo<Libraries>(() => ["drawing", "geometry"], []);
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY as string,
    libraries,
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const drawingMgrRef = useRef<google.maps.drawing.DrawingManager | null>(null);

  const [areas, setAreas] = useState<ServiceAreaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ownership map: area_id -> { ownedBy?: string }
  const [ownMap, setOwnMap] = useState<Record<string, { ownedBy?: string }>>({});

  // sponsor/manage modal
  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [sponsorArea, setSponsorArea] = useState<ServiceAreaRow | null>(null);
  const [previewGeo, setPreviewGeo] = useState<any | null>(null);

  const [manageOpen, setManageOpen] = useState(false);
  const [manageAreaId, setManageAreaId] = useState<string | null>(null);

  // ——— Load areas
  const loadAreas = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase.rpc("list_service_areas", {
        p_cleaner_id: cleanerId,
      });
      if (error) throw error;
      setAreas(data || []);
    } catch (e: any) {
      setErr(e.message || "Failed to load areas");
    } finally {
      setLoading(false);
    }
  }, [cleanerId]);

  useEffect(() => {
    if (!cleanerId) return;
    loadAreas();
  }, [loadAreas, cleanerId]);

  // ——— Ownership (single slot)
  const loadOwnership = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      try {
        const res = await fetch("/.netlify/functions/area-sponsorship", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ areaIds: ids }),
        });
        if (!res.ok) throw new Error(`area-sponsorship ${res.status}`);
        const j = await res.json();

        // Support both shapes:
        // 1) { areas: [{area_id, slots:[{slot, owner_business_id, status}]}] }
        // 2) flat array [{ area_id, slot, ... }]
        const map: Record<string, { ownedBy?: string }> = {};

        const arr = Array.isArray(j?.areas) ? j.areas : Array.isArray(j) ? j : [];
        for (const a of arr) {
          const areaId = a.area_id || a.id || a.areaId;
          const slots = Array.isArray(a.slots) ? a.slots : [a];
          const s1 = slots.find((s: any) => Number(s.slot) === 1);
          if (s1 && s1.owner_business_id) {
            map[areaId] = { ownedBy: s1.owner_business_id };
          }
        }
        setOwnMap(map);
      } catch {
        setOwnMap({});
      }
    },
    []
  );

  useEffect(() => {
    loadOwnership(areas.map((a) => a.id));
  }, [areas, loadOwnership]);

  // ——— Map load & fit to first area
  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  useEffect(() => {
    if (!isLoaded || !mapRef.current || !areas.length) return;
    const gj = areas[0].gj;
    if (!gj?.coordinates) return;

    const b = new google.maps.LatLngBounds();
    (gj.coordinates as number[][][][]).forEach((poly) =>
      poly.forEach((ring) =>
        ring.forEach(([lng, lat]) => b.extend(new google.maps.LatLng(lat, lng)))
      )
    );
    if (!b.isEmpty()) mapRef.current.fitBounds(b);
  }, [isLoaded, areas]);

  // preview overlay
  const paintedPreview = useMemo(() => {
    if (!previewGeo) return [];
    if (previewGeo.type === "Polygon") {
      return [
        {
          paths: (previewGeo.coordinates as number[][][]).map((ring) =>
            ring.map(([lng, lat]) => ({ lat, lng }))
          ),
        },
      ];
    }
    if (previewGeo.type === "MultiPolygon") {
      return (previewGeo.coordinates as number[][][][]).map((poly) => ({
        paths: poly.map((ring) => ring.map(([lng, lat]) => ({ lat, lng }))),
      }));
    }
    return [];
  }, [previewGeo]);

  // —— Render
  if (loadError) return <div className="card card-pad text-red-600">Failed to load Google Maps.</div>;

  return (
    <>
      <div className="grid md:grid-cols-12 gap-6">
        <div className="md:col-span-4 space-y-4">
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-lg">Service Areas</h3>
            </div>

            {loading && <div className="text-sm text-gray-500 mb-2">Loading…</div>}
            {err && (
              <div className="mb-2 text-sm text-red-600 bg-red-50 rounded p-2 border border-red-200">
                {err}
              </div>
            )}

            <ul className="space-y-2">
              {areas.map((a) => {
                const ownedBy = ownMap[a.id]?.ownedBy;
                const isMine = ownedBy && ownedBy === a.business_id; // (your backend may return owner_business_id; adjust if needed)
                const takenByOther = ownedBy && ownedBy !== a.business_id;

                // compute total km² client-side
                const totalM2 = isLoaded ? multiPolygonAreaMeters(a.gj) : 0;
                const totalKm2 = totalM2 / 1_000_000;

                return (
                  <li key={a.id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{a.name}</div>
                        <div className="text-xs text-gray-500">
                          {new Date(a.created_at).toLocaleString()} • Total {fmtKm2(totalM2)} km²
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="btn"
                          onClick={() => {
                            setSponsorArea(a);
                            setSponsorOpen(true);
                          }}
                          disabled={takenByOther}
                          title={takenByOther ? "Taken by another business" : "Sponsor"}
                        >
                          {isMine ? "Manage" : takenByOther ? "Taken" : "Sponsor"}
                        </button>

                        {/* If it's yours, also show Manage explicitly */}
                        {isMine && (
                          <button
                            className="btn"
                            onClick={() => {
                              setManageAreaId(a.id);
                              setManageOpen(true);
                            }}
                          >
                            Manage
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="card card-pad text-sm text-gray-600">
            <div className="font-semibold mb-1">Legend</div>
            <div className="flex items-center gap-4 mb-3">
              <span className="inline-flex items-center gap-1">
                <i
                  className="inline-block w-4 h-4 rounded"
                  style={{ background: "rgba(255,215,0,0.35)", border: "2px solid #B8860B" }}
                />
                Sponsored area
              </span>
            </div>
            <div className="font-semibold mb-1">Tips</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Click “Sponsor” to preview the purchasable sub-region and price.</li>
            </ul>
          </div>
        </div>

        <div className="md:col-span-8">
          {isLoaded ? (
            <GoogleMap
              mapContainerStyle={MAP_CONTAINER}
              center={DEFAULT_CENTER}
              zoom={DEFAULT_ZOOM}
              options={{ mapTypeControl: false, streetViewControl: false }}
              onLoad={onMapLoad}
            >
              <DrawingManager
                onLoad={(dm) => (drawingMgrRef.current = dm)}
                options={{ drawingMode: null, drawingControl: false }}
              />

              {/* Draw the user areas */}
              {areas.map((a) => {
                const gj = a.gj;
                if (!gj?.coordinates) return null;
                return (gj.coordinates as number[][][][]).map((poly, i) => {
                  const paths = poly.map((ring) => ring.map(([lng, lat]) => ({ lat, lng })));
                  return <Polygon key={`${a.id}-${i}`} paths={paths} options={{ ...basePoly }} />;
                });
              })}

              {/* Preview purchasable overlay */}
              {paintedPreview.map((p, i) => (
                <Polygon
                  key={`preview-${i}`}
                  paths={p.paths}
                  options={{
                    strokeWeight: 3,
                    strokeOpacity: 1,
                    strokeColor: "#14b8a6",
                    fillColor: "#14b8a6",
                    fillOpacity: 0.22,
                    clickable: false,
                    editable: false,
                    draggable: false,
                    zIndex: 9999,
                  }}
                />
              ))}
            </GoogleMap>
          ) : (
            <div className="card card-pad">Loading map…</div>
          )}
        </div>
      </div>

      {/* Sponsor (single slot) */}
      {sponsorOpen && sponsorArea && (
        <AreaSponsorModal
          open={sponsorOpen}
          onClose={() => {
            setSponsorOpen(false);
            setSponsorArea(null);
            setPreviewGeo(null);
          }}
          businessId={cleanerId}
          areaId={sponsorArea.id}
          areaName={sponsorArea.name}
          totalKm2={isLoaded ? multiPolygonAreaMeters(sponsorArea.gj) / 1_000_000 : 0}
          onPreviewGeoJSON={(gj) => setPreviewGeo(gj)}
          onClearPreview={() => setPreviewGeo(null)}
        />
      )}

      {/* Manage (if already yours) */}
      {manageOpen && manageAreaId && (
        <AreaManageModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          cleanerId={cleanerId}
          areaId={manageAreaId}
          slot={1}
        />
      )}
    </>
  );
}
