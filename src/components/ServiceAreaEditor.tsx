import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Polygon, DrawingManager, useJsApiLoader } from "@react-google-maps/api";
import { supabase } from "../lib/supabase";

/**
 * ServiceAreaEditor
 * - Draw, edit, name, save, list and delete multiple coverage areas for a cleaner
 * - Stores geometry as GeoJSON MultiPolygon in `service_areas.gj`
 * - Uses Supabase RPCs: list_service_areas, insert_service_area, update_service_area (optional), delete_service_area
 * - Tailwind helpers expected: card, card-pad, btn, input, etc.
 */

// ---- Types ----
export interface ServiceAreaRow {
  id: string;
  cleaner_id: string;
  name: string;
  gj: any; // GeoJSON MultiPolygon
  created_at: string;
}

type Libraries = ("drawing" | "places" | "geometry")[]; // Typings fix for @react-google-maps/api

const MAP_CONTAINER_STYLE: google.maps.MapOptions["styles"] = undefined;
const MAP_CONTAINER = { width: "100%", height: "600px" } as const;

const DEFAULT_CENTER = { lat: 54.607868, lng: -5.926437 }; // Belfast-ish fallback
const DEFAULT_ZOOM = 10;

// Polygon rendering style
const polyStyle: google.maps.PolygonOptions = {
  strokeWeight: 2,
  strokeOpacity: 0.9,
  fillOpacity: 0.2,
  clickable: true,
  editable: true,
  draggable: false,
};

// Helper to round coords for duplicate detection
const round = (n: number, p = 5) => Number(n.toFixed(p));

// Convert Google Polygon paths -> GeoJSON coordinates [[[lng,lat]...]] and close ring
function pathToGeoJSONRing(path: google.maps.MVCArray<google.maps.LatLng> | google.maps.LatLng[]): number[][] {
  const arr: number[][] = [];
  const len = (path as any).getLength ? (path as any).getLength() : (path as google.maps.LatLng[]).length;
  for (let i = 0; i < len; i++) {
    const pt: google.maps.LatLng = (path as any).getAt ? (path as any).getAt(i) : (path as google.maps.LatLng[])[i];
    arr.push([round(pt.lng()), round(pt.lat())]);
  }
  // Close the ring if not already
  if (arr.length && (arr[0][0] !== arr[arr.length - 1][0] || arr[0][1] !== arr[arr.length - 1][1])) {
    arr.push([arr[0][0], arr[0][1]]);
  }
  return arr;
}

// Assemble MultiPolygon from an array of google.maps.Polygon
function makeMultiPolygon(polys: google.maps.Polygon[]): any {
  // MultiPolygon = array of Polygons; each Polygon = array of LinearRings; each LinearRing = array of [lng,lat]
  const coords: number[][][][] = polys.map((poly) => {
    const paths = poly.getPaths();
    const rings: number[][][] = [];
    for (let i = 0; i < paths.getLength(); i++) {
      const path = paths.getAt(i);
      rings.push(pathToGeoJSONRing(path));
    }
    return rings; // <— one Polygon worth of rings
  });
  return { type: "MultiPolygon", coordinates: coords };
}

// Normalize MultiPolygon for rough duplicate detection
function normalizeMultiPolygon(multi: any): string {
  if (!multi || multi.type !== "MultiPolygon") return "";
  const polys = (multi.coordinates as number[][][][]).map((rings: number[][][]) =>
    rings
      .map((ring: number[][]) => ring.map(([lng, lat]) => [round(lng, 5), round(lat, 5)]))
      .map((ring: number[][]) => JSON.stringify(ring))
      .sort()
      .join("|")
  );
  return polys.sort().join("||");
}

// Compute area (m²) of a google.maps.Polygon (outer - holes)
function polygonAreaMeters(p: google.maps.Polygon): number {
  let area = 0;
  const paths = p.getPaths();
  for (let i = 0; i < paths.getLength(); i++) {
    const path = paths.getAt(i);
    const arr: google.maps.LatLng[] = [];
    for (let j = 0; j < path.getLength(); j++) arr.push(path.getAt(j));
    const ringArea = google.maps.geometry.spherical.computeArea(arr);
    // First ring = outer (positive), subsequent rings treated as holes
    area += i === 0 ? Math.abs(ringArea) : -Math.abs(ringArea);
  }
  return Math.max(0, area);
}

// Sum area for array of polygons
function totalAreaMeters(polys: google.maps.Polygon[]): number {
  return polys.reduce((sum, p) => sum + polygonAreaMeters(p), 0);
}

// km² + hectares formatting
function fmtArea(m2: number) {
  const hectares = m2 / 10_000;
  const km2 = m2 / 1_000_000;
  return `${km2.toFixed(2)} km² (${hectares.toFixed(1)} ha)`;
}

// ---------------- Component ----------------
export default function ServiceAreaEditor({ cleanerId }: { cleanerId: string }) {
  const libraries = useMemo<Libraries>(() => ["drawing", "geometry"], []);
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY as string,
    libraries,
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const drawingMgrRef = useRef<google.maps.drawing.DrawingManager | null>(null);
  const [serviceAreas, setServiceAreas] = useState<ServiceAreaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // current workbench (new or editing existing)
  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string>("");
  const [draftPolys, setDraftPolys] = useState<google.maps.Polygon[]>([]);

  const resetDraft = useCallback(() => {
    draftPolys.forEach((p) => p.setMap(null));
    setDraftPolys([]);
    setDraftName("");
    setActiveAreaId(null);
  }, [draftPolys]);

  // Fetch areas
  const fetchAreas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc("list_service_areas", { p_cleaner_id: cleanerId });
      if (error) throw error;
      setServiceAreas(data || []);
    } catch (e: any) {
      setError(e.message || "Failed to load service areas");
    } finally {
      setLoading(false);
    }
  }, [cleanerId]);

  useEffect(() => {
    fetchAreas();
  }, [fetchAreas]);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const onDrawingLoad = useCallback((dm: google.maps.drawing.DrawingManager) => {
    drawingMgrRef.current = dm;
  }, []);

  // When user completes a polygon via DrawingManager
  const onPolygonComplete = useCallback((poly: google.maps.Polygon) => {
    poly.setOptions(polyStyle);
    poly.setEditable(true);
    setDraftPolys((prev) => [...prev, poly]);
  }, []);

  // Start a new area
  const startNewArea = useCallback(() => {
    resetDraft();
    setDraftName("New Service Area");
    setTimeout(() => drawingMgrRef.current?.setDrawingMode(google.maps.drawing.OverlayType.POLYGON), 0);
  }, [resetDraft]);

  // Edit an existing area -> load polygons onto map
  const editArea = useCallback(
    (area: ServiceAreaRow) => {
      resetDraft();
      setActiveAreaId(area.id);
      setDraftName(area.name);
      const gj = area.gj;
      if (!gj || gj.type !== "MultiPolygon") return;
      const newPolys: google.maps.Polygon[] = [];
      (gj.coordinates as number[][][][]).forEach((poly) => {
        const rings = poly;
        const paths = rings.map((ring) => ring.map(([lng, lat]) => ({ lat, lng })));
        const gpoly = new google.maps.Polygon({ paths, ...polyStyle, editable: true });
        gpoly.setMap(mapRef.current);
        newPolys.push(gpoly);
      });
      setDraftPolys(newPolys);
    },
    [resetDraft]
  );

  // Validate & Save (insert or update)
  const saveDraft = useCallback(async () => {
    if (!draftPolys.length) {
      setError("Draw at least one polygon.");
      return;
    }
    const multi = makeMultiPolygon(draftPolys);

    // Duplicate detection against existing (simple heuristic)
    const newKey = normalizeMultiPolygon(multi);
    const dup = serviceAreas.find((a) => normalizeMultiPolygon(a.gj) === newKey && a.id !== activeAreaId);
    if (dup) {
      setError(`This area matches an existing one: “${dup.name}”.`);
      return;
    }

    const areaM2 = totalAreaMeters(draftPolys);
    if (areaM2 < 50) {
      setError("Area is too small to be valid.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (activeAreaId) {
        // update
        const { data, error } = await supabase.rpc("update_service_area", {
          p_area_id: activeAreaId,
          p_cleaner_id: cleanerId,
          p_gj: multi,
          p_name: draftName || "Untitled Area",
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.rpc("insert_service_area", {
          p_cleaner_id: cleanerId,
          p_gj: multi,
          p_name: draftName || "Untitled Area",
        });
        if (error) throw error;
      }
      await fetchAreas();
      resetDraft();
    } catch (e: any) {
      setError(e.message || "Failed to save area");
    } finally {
      setLoading(false);
    }
  }, [activeAreaId, cleanerId, draftName, draftPolys, fetchAreas, resetDraft, serviceAreas]);

  const deleteArea = useCallback(
    async (area: ServiceAreaRow) => {
      if (!confirm(`Delete “${area.name}”?`)) return;
      setLoading(true);
      setError(null);
      try {
        const { error } = await supabase.rpc("delete_service_area", { p_area_id: area.id, p_cleaner_id: cleanerId });
        if (error) throw error;
        await fetchAreas();
      } catch (e: any) {
        setError(e.message || "Failed to delete area");
      } finally {
        setLoading(false);
      }
    },
    [cleanerId, fetchAreas]
  );

  const cancelDraft = useCallback(() => {
    resetDraft();
  }, [resetDraft]);

  // Center map on first area if available
  useEffect(() => {
    if (!isLoaded || !mapRef.current || !serviceAreas.length) return;
    const area = serviceAreas[0];
    const gj = area.gj;
    if (!gj || gj.type !== "MultiPolygon") return;
    const bounds = new google.maps.LatLngBounds();
    (gj.coordinates as number[][][][]).forEach((poly) => {
      const rings = poly;
      rings.forEach((ring) =>
        ring.forEach(([lng, lat]) => bounds.extend(new google.maps.LatLng(lat, lng)))
      );
    });
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds);
  }, [isLoaded, serviceAreas]);

  // UI helpers
  const totalDraftArea = useMemo(() => (isLoaded ? totalAreaMeters(draftPolys) : 0), [isLoaded, draftPolys]);

  if (loadError) return <div className="card card-pad text-red-600">Failed to load Google Maps.</div>;

  return (
    <div className="grid md:grid-cols-12 gap-6">
      {/* Left panel */}
      <div className="md:col-span-4 space-y-4">
        <div className="card card-pad">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-lg">Service Areas</h3>
            <button className="btn" onClick={startNewArea} disabled={!isLoaded || loading}>
              + New Area
            </button>
          </div>
          {loading && <div className="text-sm text-gray-500 mb-2">Working…</div>}
          {error && (
            <div className="mb-2 text-sm text-red-600 bg-red-50 rounded p-2 border border-red-200">{error}</div>
          )}

          {/* Draft editor */}
          {(draftPolys.length > 0 || activeAreaId !== null) && (
            <div className="border rounded-lg p-3 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <input
                  className="input w-full"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Area name"
                />
              </div>
              <div className="text-sm text-gray-600 mb-2">
                Polygons: {draftPolys.length} • Coverage: {fmtArea(totalDraftArea)}
              </div>
              <div className="flex gap-2">
                <button className="btn" onClick={saveDraft} disabled={loading}>
                  {activeAreaId ? "Save Changes" : "Save Area"}
                </button>
                <button className="btn" onClick={cancelDraft} disabled={loading}>
                  Cancel
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    draftPolys.forEach((p) => p.setMap(null));
                    setDraftPolys([]);
                  }}
                  disabled={loading || draftPolys.length === 0}
                >
                  Clear Polygons
                </button>
              </div>
            </div>
          )}

          {/* List */}
          <ul className="space-y-2">
            {serviceAreas.map((a) => (
              <li key={a.id} className="border rounded-lg p-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-gray-500">{new Date(a.created_at).toLocaleString()}</div>
                </div>
                <div className="flex gap-2">
                  <button className="btn" onClick={() => editArea(a)} disabled={loading}>
                    Edit
                  </button>
                  <button className="btn" onClick={() => deleteArea(a)} disabled={loading}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {!serviceAreas.length && !loading && (
              <li className="text-sm text-gray-500">No service areas yet. Click “New Area” to draw one.</li>
            )}
          </ul>
        </div>

        <div className="card card-pad text-sm text-gray-600">
          <div className="font-semibold mb-1">Tips</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>Click “New Area”, then click around the map to draw a polygon. Double‑click to finish.</li>
            <li>Drag the white handles to adjust vertices. Use “Clear Polygons” to redraw before saving.</li>
            <li>Each saved Service Area may include multiple polygons.</li>
          </ul>
        </div>
      </div>

      {/* Map */}
      <div className="md:col-span-8">
        {isLoaded ? (
          <GoogleMap
            mapContainerStyle={MAP_CONTAINER}
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            options={{ styles: MAP_CONTAINER_STYLE, mapTypeControl: false, streetViewControl: false }}
            onLoad={onMapLoad}
          >
            <DrawingManager
              onLoad={onDrawingLoad}
              onPolygonComplete={onPolygonComplete}
              options={{
                drawingMode: null,
                drawingControl: true,
                drawingControlOptions: {
                  drawingModes: [google.maps.drawing.OverlayType.POLYGON],
                },
                polygonOptions: polyStyle,
              }}
            />

            {/* Render existing areas as non-editable preview when not in draft mode */}
            {activeAreaId === null && serviceAreas.map((a) => {
              const gj = a.gj;
              if (!gj || gj.type !== "MultiPolygon") return null;
              return (gj.coordinates as number[][][][]).map((poly, i) => {
                const rings = poly;
                const paths = rings.map((ring) => ring.map(([lng, lat]) => ({ lat, lng })));
                return <Polygon key={`${a.id}-${i}`} paths={paths} options={{ ...polyStyle, editable: false, draggable: false }} />;
              });
            })}
          </GoogleMap>
        ) : (
          <div className="card card-pad">Loading map…</div>
        )}
      </div>
    </div>
  );
}
