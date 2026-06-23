import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Polygon, Polyline, useJsApiLoader } from "@react-google-maps/api";
import { supabase } from "../lib/supabase";
import AreaSponsorModal from "./AreaSponsorModal";
import AreaManageModal from "./AreaManageModal";
import DeleteAreaModal from "./DeleteAreaModal";

type LatLng = google.maps.LatLngLiteral;
type Libraries = ["geometry"];

type ServiceAreaRow = {
  id: string;
  cleaner_id: string;
  category_id: string | null;
  name: string;
  gj: any;
  created_at: string;
  km2?: number | null;
  is_sponsored_locked?: boolean;
  sponsored_until?: string | null;
};

type Props = {
  businessId?: string;
  cleanerId?: string;
  categoryId?: string | null;
  sponsorshipVersion?: number;
  onSlotAction?: (area: { id: string; name?: string }, slot: 1) => void | Promise<void>;
};

const MAP_CONTAINER = { width: "100%", height: "600px" } as const;
const DEFAULT_CENTER = { lat: 54.607868, lng: -5.926437 };
const DEFAULT_ZOOM = 10;

const basePolyOptions: google.maps.PolygonOptions = {
  strokeWeight: 2,
  strokeOpacity: 0.9,
  fillOpacity: 0.25,
  clickable: false,
  editable: false,
  draggable: false,
};

function maybeParseGeo(geo: any) {
  if (!geo) return null;
  if (typeof geo === "string") {
    try {
      return JSON.parse(geo);
    } catch {
      return null;
    }
  }
  return geo;
}

function pairToLatLng(pair: any): LatLng | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const a = Number(pair[0]);
  const b = Number(pair[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const aLooksLikeLatUK = a >= 49 && a <= 61;
  const bLooksLikeLngUK = b >= -11 && b <= 4;
  const bLooksLikeLatUK = b >= 49 && b <= 61;
  const aLooksLikeLngUK = a >= -11 && a <= 4;

  if (aLooksLikeLatUK && bLooksLikeLngUK && !bLooksLikeLatUK) return { lat: a, lng: b };
  if (bLooksLikeLatUK && aLooksLikeLngUK && !aLooksLikeLatUK) return { lat: b, lng: a };

  return { lat: b, lng: a };
}

function geoToPaths(geoInput: any): { paths: LatLng[][] }[] {
  const geo = maybeParseGeo(geoInput);
  if (!geo) return [];

  if (geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
    return geo.features.flatMap((f: any) => geoToPaths(f));
  }

  if (geo.type === "Feature" && geo.geometry) return geoToPaths(geo.geometry);

  if (geo.type === "Polygon" && Array.isArray(geo.coordinates)) {
    return [
      {
        paths: geo.coordinates.map((ring: any[]) =>
          ring.map((pair) => pairToLatLng(pair)).filter(Boolean) as LatLng[]
        ),
      },
    ];
  }

  if (geo.type === "MultiPolygon" && Array.isArray(geo.coordinates)) {
    return geo.coordinates.map((poly: any[]) => ({
      paths: poly.map((ring: any[]) =>
        ring.map((pair) => pairToLatLng(pair)).filter(Boolean) as LatLng[]
      ),
    }));
  }

  if (geo.geometry) return geoToPaths(geo.geometry);
  if (geo.geojson) return geoToPaths(geo.geojson);
  if (geo.multi) return geoToPaths(geo.multi);
  return [];
}

function firstPolygonRing(geoInput: any): LatLng[] {
  return geoToPaths(geoInput)[0]?.paths?.[0]?.filter(Boolean) ?? [];
}

function ringToGeoJson(ring: LatLng[]): number[][] {
  const out = ring.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) out.push(first);
  return out;
}

function draftToMultiPolygon(polys: LatLng[][]) {
  const ring = polys[0] ?? [];
  return {
    type: "MultiPolygon",
    coordinates: [[ringToGeoJson(ring)]],
  };
}

function areaMetersForRing(ring: LatLng[]) {
  if (ring.length < 3 || !window.google?.maps?.geometry?.spherical) return 0;
  return google.maps.geometry.spherical.computeArea(ring.map((p) => new google.maps.LatLng(p.lat, p.lng)));
}

function formatArea(polys: LatLng[][]) {
  const m2 = areaMetersForRing(polys[0] ?? []);
  return `${(m2 / 1_000_000).toFixed(2)} km² (${(m2 / 10_000).toFixed(1)} ha)`;
}

function samePoint(a: LatLng | undefined, b: LatLng) {
  return !!a && Math.abs(a.lat - b.lat) < 0.0000001 && Math.abs(a.lng - b.lng) < 0.0000001;
}

export default function ServiceAreaEditorSafe({
  businessId,
  cleanerId,
  categoryId = null,
  sponsorshipVersion = 0,
  onSlotAction,
}: Props) {
  const myBusinessId = (businessId ?? cleanerId) || "";
  const mapRef = useRef<google.maps.Map | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);

  const libraries = useMemo<Libraries>(() => ["geometry"], []);
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY as string,
    libraries,
  });

  const [serviceAreas, setServiceAreas] = useState<ServiceAreaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftPolys, setDraftPolys] = useState<LatLng[][]>([]);
  const [drawingPoints, setDrawingPoints] = useState<LatLng[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [sponsorAreaId, setSponsorAreaId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageAreaId, setManageAreaId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteAreaId, setDeleteAreaId] = useState<string | null>(null);
  const [deleteAreaName, setDeleteAreaName] = useState("");
  const [previewGeo, setPreviewGeo] = useState<any | null>(null);

  const previewPolys = useMemo(() => geoToPaths(previewGeo), [previewGeo]);

  const fetchAreas = useCallback(async () => {
    if (!myBusinessId) return;
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.rpc("list_service_areas", {
        p_cleaner_id: myBusinessId,
        p_category_id: categoryId,
      });
      if (error) throw error;
      setServiceAreas((data || []) as ServiceAreaRow[]);
    } catch (e: any) {
      setError(e?.message || "Failed to load service areas.");
    } finally {
      setLoading(false);
    }
  }, [myBusinessId, categoryId]);

  useEffect(() => {
    fetchAreas();
  }, [fetchAreas, sponsorshipVersion]);

  useEffect(() => {
    setCreating(false);
    setActiveAreaId(null);
    setDraftName("");
    setDraftPolys([]);
    setDrawingPoints([]);
    setIsDrawing(false);
    setPreviewGeo(null);
  }, [categoryId]);

  const resetDraft = useCallback(() => {
    setCreating(false);
    setActiveAreaId(null);
    setDraftName("");
    setDraftPolys([]);
    setDrawingPoints([]);
    setIsDrawing(false);
    setError(null);
  }, []);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const zoomToArea = useCallback((area: ServiceAreaRow) => {
    if (!mapRef.current) return;
    const ring = firstPolygonRing(area.gj);
    const bounds = new google.maps.LatLngBounds();
    ring.forEach((p) => bounds.extend(p));
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 60);
  }, []);

  useEffect(() => {
    if (isLoaded && serviceAreas[0]) zoomToArea(serviceAreas[0]);
  }, [isLoaded, serviceAreas, zoomToArea]);

  const startNewArea = useCallback(() => {
    resetDraft();
    setCreating(true);
    setDraftName("New Service Area");
    setIsDrawing(true);
  }, [resetDraft]);

  const editArea = useCallback(
    (area: ServiceAreaRow) => {
      resetDraft();
      setCreating(true);
      setActiveAreaId(area.id);
      setDraftName(area.name || "Service Area");
      const ring = firstPolygonRing(area.gj);
      setDraftPolys(ring.length >= 3 ? [ring] : []);
      zoomToArea(area);
    },
    [resetDraft, zoomToArea]
  );

  const onMapClick = useCallback(
    (ev: google.maps.MapMouseEvent) => {
      if (!isDrawing || !ev.latLng) return;
      if (draftPolys.length >= 1) {
        setError("Only one polygon is allowed per service area. Clear the current polygon to redraw it.");
        return;
      }
      const next = { lat: ev.latLng.lat(), lng: ev.latLng.lng() };
      setDrawingPoints((prev) => (samePoint(prev[prev.length - 1], next) ? prev : [...prev, next]));
      setError(null);
    },
    [draftPolys.length, isDrawing]
  );

  const finishPolygon = useCallback(() => {
    if (drawingPoints.length < 3) {
      setError("Click at least 3 points on the map before finishing the polygon.");
      return;
    }

    setDraftPolys([drawingPoints]);
    setDrawingPoints([]);
    setIsDrawing(false);
    setError(null);
  }, [drawingPoints]);

  const onMapDblClick = useCallback(
    (ev: google.maps.MapMouseEvent) => {
      if (!isDrawing) return;
      ev.domEvent?.preventDefault?.();
      finishPolygon();
    },
    [finishPolygon, isDrawing]
  );

  const saveDraft = useCallback(async () => {
    if (isDrawing) {
      setError("Finish the polygon before saving.");
      return;
    }

    if (!myBusinessId) {
      setError("Cleaner profile not loaded.");
      return;
    }

    if (draftPolys.length !== 1) {
      setError("Each service area must have exactly one polygon.");
      return;
    }

    if (draftPolys[0].length < 3) {
      setError("Draw at least 3 points before saving.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = draftToMultiPolygon(draftPolys);
      if (activeAreaId) {
        const { error } = await supabase.rpc("update_service_area", {
          p_area_id: activeAreaId,
          p_gj: payload,
          p_name: draftName || "Untitled Area",
          p_category_id: categoryId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("insert_service_area", {
          p_cleaner_id: myBusinessId,
          p_gj: payload,
          p_name: draftName || "Untitled Area",
          p_category_id: categoryId,
        });
        if (error) throw error;
      }

      resetDraft();
      await fetchAreas();
    } catch (e: any) {
      setError(e?.message || "Failed to save area.");
    } finally {
      setLoading(false);
    }
  }, [activeAreaId, categoryId, draftName, draftPolys, fetchAreas, isDrawing, myBusinessId, resetDraft]);

  const deleteArea = useCallback((area: ServiceAreaRow) => {
    setDeleteAreaId(area.id);
    setDeleteAreaName(area.name || "Service Area");
    setDeleteOpen(true);
  }, []);

  if (loadError) {
    return <div className="card card-pad text-red-600">Failed to load Google Maps.</div>;
  }

  return (
    <>
      <div className="grid md:grid-cols-12 gap-6">
        <div className="md:col-span-4 space-y-4">
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-lg">Service Areas</h3>
              <button className="btn" onClick={startNewArea} disabled={!isLoaded || loading}>
                + New Area
              </button>
            </div>

            {loading && <div className="text-sm text-gray-500 mb-2">Working...</div>}

            {error && (
              <div className="mb-2 text-sm text-red-600 bg-red-50 rounded p-2 border border-red-200">
                {error}
              </div>
            )}

            {(creating || activeAreaId || draftPolys.length > 0 || isDrawing) && (
              <div className="border rounded-lg p-3 mb-4">
                <input
                  className="input w-full mb-2"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Area name"
                />

                {isDrawing && (
                  <div className="text-xs text-gray-600 mb-2">
                    Drawing mode is ON - click points on the map, then press Finish Polygon.
                  </div>
                )}

                <div className="text-sm text-gray-600 mb-2">
                  Polygon: {draftPolys.length === 1 ? "ready" : "not drawn"} | Points: {drawingPoints.length} | Coverage: {formatArea(draftPolys)}
                </div>

                <div className="flex flex-wrap gap-2">
                  {isDrawing && (
                    <button className="btn" onClick={finishPolygon} disabled={drawingPoints.length < 3 || loading}>
                      Finish Polygon
                    </button>
                  )}
                  {isDrawing && (
                    <button
                      className="btn"
                      onClick={() => setDrawingPoints((prev) => prev.slice(0, -1))}
                      disabled={drawingPoints.length === 0 || loading}
                    >
                      Undo Point
                    </button>
                  )}
                  {creating && !isDrawing && draftPolys.length === 0 && (
                    <button className="btn" onClick={() => setIsDrawing(true)} disabled={loading}>
                      Draw Polygon
                    </button>
                  )}
                  <button className="btn" onClick={saveDraft} disabled={loading || isDrawing}>
                    {activeAreaId ? "Save Changes" : "Save Area"}
                  </button>
                  <button className="btn" onClick={resetDraft} disabled={loading}>
                    Cancel
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setDraftPolys([]);
                      setDrawingPoints([]);
                      setIsDrawing(false);
                    }}
                    disabled={loading || (!draftPolys.length && !drawingPoints.length)}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            <ul className="space-y-2">
              {serviceAreas.map((area) => (
                <li key={area.id} className="border rounded-lg p-3 bg-white">
                  <button type="button" className="text-left w-full group" onClick={() => zoomToArea(area)}>
                    <div className="font-medium truncate group-hover:underline">{area.name}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(area.created_at).toLocaleString()}
                    </div>
                  </button>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className="btn" onClick={() => editArea(area)} disabled={loading}>
                      Edit
                    </button>
                    <button className="btn" onClick={() => deleteArea(area)} disabled={loading}>
                      Delete
                    </button>
                    <button
                      className="btn"
                      onClick={async () => {
                        if (!categoryId) {
                          setError("Please select an industry first.");
                          return;
                        }
                        if (onSlotAction) await onSlotAction({ id: area.id, name: area.name }, 1);
                        else {
                          setSponsorAreaId(area.id);
                          setSponsorOpen(true);
                        }
                      }}
                      disabled={loading || !categoryId}
                    >
                      Sponsor (Featured)
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setManageAreaId(area.id);
                        setManageOpen(true);
                      }}
                      disabled={loading}
                    >
                      Manage
                    </button>
                  </div>
                </li>
              ))}

              {!serviceAreas.length && !loading && (
                <li className="text-sm text-gray-500">No service areas yet. Click New Area to draw one.</li>
              )}
            </ul>
          </div>

          <div className="card card-pad text-sm text-gray-600">
            <div className="font-semibold mb-1">How to use the map</div>
            <ul className="list-disc pl-5 space-y-1 text-xs">
              <li>Click New Area.</li>
              <li>Click around the map to add points.</li>
              <li>Press Finish Polygon, then Save Area.</li>
              <li>Each service area can contain one polygon only.</li>
            </ul>
          </div>
        </div>

        <div ref={mapWrapRef} className="md:col-span-8" id="service-area-map">
          {isLoaded ? (
            <GoogleMap
              mapContainerStyle={MAP_CONTAINER}
              center={DEFAULT_CENTER}
              zoom={DEFAULT_ZOOM}
              options={{
                mapTypeControl: false,
                streetViewControl: false,
                disableDoubleClickZoom: isDrawing,
                draggableCursor: isDrawing ? "crosshair" : undefined,
              }}
              onLoad={onMapLoad}
              onClick={onMapClick}
              onDblClick={onMapDblClick}
            >
              {serviceAreas.map((area) => {
                const ring = firstPolygonRing(area.gj);
                if (ring.length < 3) return null;
                return (
                  <Polygon
                    key={`area-${area.id}`}
                    paths={ring}
                    options={{
                      ...basePolyOptions,
                      strokeColor: "#111827",
                      fillColor: "#111827",
                      fillOpacity: activeAreaId ? 0.05 : 0.08,
                      zIndex: 100,
                    }}
                  />
                );
              })}

              {draftPolys.map((ring, index) => (
                <Polygon
                  key={`draft-${index}`}
                  paths={ring}
                  options={{
                    ...basePolyOptions,
                    strokeColor: "#2563eb",
                    fillColor: "#2563eb",
                    fillOpacity: 0.2,
                    zIndex: 300,
                  }}
                />
              ))}

              {drawingPoints.length > 0 && (
                <Polyline
                  path={drawingPoints}
                  options={{ strokeColor: "#2563eb", strokeOpacity: 0.9, strokeWeight: 3, clickable: false, zIndex: 500 }}
                />
              )}

              {drawingPoints.length >= 3 && (
                <Polygon
                  paths={drawingPoints}
                  options={{
                    ...basePolyOptions,
                    strokeColor: "#2563eb",
                    fillColor: "#2563eb",
                    fillOpacity: 0.15,
                    zIndex: 499,
                  }}
                />
              )}

              {previewPolys.map((poly, index) => (
                <Polygon
                  key={`preview-${index}`}
                  paths={poly.paths}
                  options={{
                    ...basePolyOptions,
                    strokeOpacity: 0,
                    fillColor: "#14b8a6",
                    fillOpacity: 0.22,
                    zIndex: 150,
                  }}
                />
              ))}
            </GoogleMap>
          ) : (
            <div className="card card-pad">Loading map...</div>
          )}
        </div>
      </div>

      {sponsorOpen && sponsorAreaId && categoryId && (
        <AreaSponsorModal
          open={sponsorOpen}
          onClose={() => {
            setSponsorOpen(false);
            setPreviewGeo(null);
          }}
          businessId={myBusinessId}
          categoryId={categoryId}
          areaId={sponsorAreaId}
          areaName={serviceAreas.find((x) => x.id === sponsorAreaId)?.name}
          onPreviewGeoJSON={(multi) => setPreviewGeo(multi)}
          onClearPreview={() => setPreviewGeo(null)}
        />
      )}

      {manageOpen && manageAreaId && (
        <AreaManageModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          cleanerId={myBusinessId}
          areaId={manageAreaId}
          slot={1}
        />
      )}

      {deleteOpen && deleteAreaId && (
        <DeleteAreaModal
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          areaId={deleteAreaId}
          areaName={deleteAreaName}
          cleanerId={myBusinessId}
          isSponsoredByMe={false}
          onDeleted={async () => {
            setDeleteOpen(false);
            resetDraft();
            await fetchAreas();
          }}
        />
      )}
    </>
  );
}
