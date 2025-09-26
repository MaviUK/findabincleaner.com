import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Polygon, useJsApiLoader } from "@react-google-maps/api";
import type { LatLngLiteral } from "@react-google-maps/api";
import { supabase } from "../lib/supabase";

/**
 * ServiceAreaEditor (custom drawing, no DrawingManager)
 *
 * Features
 * - Load & list areas (RPC list_service_areas)
 * - Create new area: click-to-add vertices ➜ Finish ➜ saved via insert_service_area
 * - Edit existing area: select ➜ polygon becomes editable ➜ Save to update_service_area
 * - Delete area (delete_service_area)
 * - Fit bounds to first area
 *
 * Notes
 * - Stores geometry as GeoJSON MultiPolygon in `gj`
 * - Uses only core Maps JS overlays (Polygon), avoiding deprecated Drawing Library
 */

// --- Types ---
interface ServiceAreaRow {
  id: string;
  cleaner_id: string;
  name: string | null;
  gj: any; // GeoJSON MultiPolygon
  created_at: string;
}

type Mode = "idle" | "drawing" | "editing";

// --- Helpers: GeoJSON <-> paths ---
function gjToPaths(gj: any): LatLngLiteral[][] {
  // Expect MultiPolygon [[[ [lng,lat], ... ]]]
  const paths: LatLngLiteral[][] = [];
  if (!gj || gj.type !== "MultiPolygon" || !Array.isArray(gj.coordinates)) return paths;
  // We only render the first polygon ring of each polygon (outer ring)
  for (const polygon of gj.coordinates) {
    if (!polygon || !Array.isArray(polygon[0])) continue;
    const outer = polygon[0];
    const ring: LatLngLiteral[] = outer.map((c: number[]) => ({ lat: c[1], lng: c[0] }));
    paths.push(ring);
  }
  return paths;
}

function pathsToMultiPolygonGeoJSON(paths: LatLngLiteral[][]): any {
  // MultiPolygon expects [[[ [lng,lat] ]]] with closed rings
  const coords = paths.map((ring) => {
    const closed = ring.length > 0 && (ring[0].lat !== ring[ring.length - 1].lat || ring[0].lng !== ring[ring.length - 1].lng)
      ? [...ring, ring[0]]
      : ring;
    const asLngLat = closed.map(pt => [pt.lng, pt.lat]);
    return [asLngLat]; // outer ring only
  });
  return {
    type: "MultiPolygon",
    coordinates: coords,
  };
}

// --- Map defaults ---
const containerStyle: React.CSSProperties = { width: "100%", height: 520 };
const defaultCenter: LatLngLiteral = { lat: 54.653, lng: -5.669 }; // Bangor-ish as sensible NI default

export default function ServiceAreaEditor({ cleanerId }: { cleanerId: string }) {
  const { isLoaded } = useJsApiLoader({ id: "gmap-script", googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY });

  const mapRef = useRef<google.maps.Map | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [areas, setAreas] = useState<ServiceAreaRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Draft drawing state
  const [draftPath, setDraftPath] = useState<LatLngLiteral[]>([]);

  // Live editing state for selected polygon
  const editedPathRef = useRef<LatLngLiteral[] | null>(null);
  const [editingDirty, setEditingDirty] = useState(false);

  // --- Load areas ---
  const loadAreas = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("list_service_areas", { p_cleaner_id: cleanerId });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setAreas((data ?? []) as ServiceAreaRow[]);
    setLoading(false);
  }, [cleanerId]);

  useEffect(() => {
    loadAreas();
  }, [loadAreas]);

  // --- Fit bounds to first area on initial load ---
  useEffect(() => {
    if (!isLoaded || !mapRef.current || areas.length === 0) return;
    const first = areas[0];
    const paths = gjToPaths(first.gj);
    const bounds = new google.maps.LatLngBounds();
    paths.flat().forEach((pt) => bounds.extend(pt));
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 48);
  }, [isLoaded, areas]);

  // --- Map handlers ---
  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const handleMapClick = useCallback((e: google.maps.MapMouseEvent) => {
    if (mode !== "drawing") return;
    const latLng = e.latLng?.toJSON();
    if (!latLng) return;
    setDraftPath((prev) => [...prev, latLng]);
  }, [mode]);

  // --- Start new area drawing ---
  function startNewArea() {
    setMode("drawing");
    setSelectedId(null);
    setDraftPath([]);
    setEditingDirty(false);
  }

  function undoVertex() {
    if (mode !== "drawing") return;
    setDraftPath((prev) => prev.slice(0, -1));
  }

  function clearDraft() {
    if (mode !== "drawing") return;
    setDraftPath([]);
  }

  async function finishDraft() {
    if (mode !== "drawing" || draftPath.length < 3) return;
    const gj = pathsToMultiPolygonGeoJSON([draftPath]);
    const defaultName = `Service Area ${areas.length + 1}`;
    const { data, error } = await supabase.rpc("insert_service_area", {
      p_cleaner_id: cleanerId,
      p_gj: gj,
      p_name: defaultName,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setMode("idle");
    setDraftPath([]);
    await loadAreas();
    setSelectedId((data as ServiceAreaRow)?.id ?? null);
  }

  // --- Select & edit existing area ---
  function selectArea(id: string) {
    setSelectedId(id);
    setMode("editing");
    setEditingDirty(false);
    editedPathRef.current = null;
    // Fit bounds to this area
    const found = areas.find(a => a.id === id);
    if (found && mapRef.current) {
      const b = new google.maps.LatLngBounds();
      gjToPaths(found.gj).flat().forEach(pt => b.extend(pt));
      if (!b.isEmpty()) mapRef.current.fitBounds(b, 48);
    }
  }

  function cancelEditing() {
    setMode("idle");
    setSelectedId(null);
    setEditingDirty(false);
    editedPathRef.current = null;
  }

  async function saveEditing() {
    if (mode !== "editing" || !selectedId) return;
    const area = areas.find(a => a.id === selectedId);
    if (!area) return;

    let gj = area.gj;
    if (editedPathRef.current) {
      gj = pathsToMultiPolygonGeoJSON([editedPathRef.current]);
    }

    const { error } = await supabase.rpc("update_service_area", {
      p_area_id: area.id,
      p_gj: gj,
      p_name: area.name ?? "Service Area",
    });
    if (error) {
      setError(error.message);
      return;
    }
    setEditingDirty(false);
    editedPathRef.current = null;
    await loadAreas();
  }

  async function deleteSelected() {
    if (!selectedId) return;
    const { error } = await supabase.rpc("delete_service_area", { p_area_id: selectedId });
    if (error) {
      setError(error.message);
      return;
    }
    setSelectedId(null);
    setMode("idle");
    await loadAreas();
  }

  // --- Render helpers ---
  const selectedArea = useMemo(() => areas.find(a => a.id === selectedId) ?? null, [areas, selectedId]);

  // Attach path listeners when a polygon loads in editing mode
  const onPolygonLoad = useCallback((poly: google.maps.Polygon) => {
    if (mode !== "editing" || !selectedArea) return;
    const path = poly.getPath();

    const updateRefFromPath = () => {
      const pts: LatLngLiteral[] = [];
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i).toJSON();
        pts.push(p);
      }
      editedPathRef.current = pts;
      setEditingDirty(true);
    };

    // Listen to vertex edits
    const insertListener = google.maps.event.addListener(path, "insert_at", updateRefFromPath);
    const removeListener = google.maps.event.addListener(path, "remove_at", updateRefFromPath);
    const setListener = google.maps.event.addListener(path, "set_at", updateRefFromPath);

    // Cleanup when polygon unmounts or mode changes
    return () => {
      google.maps.event.removeListener(insertListener);
      google.maps.event.removeListener(removeListener);
      google.maps.event.removeListener(setListener);
    };
  }, [mode, selectedArea]);

  // List UI
  function AreaList() {
    return (
      <div className="space-y-2">
        {areas.map((a) => (
          <button
            key={a.id}
            onClick={() => selectArea(a.id)}
            className={`w-full text-left border rounded-xl px-3 py-2 hover:bg-gray-50 ${selectedId === a.id ? "border-black bg-gray-50" : "border-gray-200"}`}
          >
            <div className="font-medium">{a.name ?? "Untitled area"}</div>
            <div className="text-xs text-gray-500">Created {new Date(a.created_at).toLocaleString()}</div>
          </button>
        ))}
        {areas.length === 0 && (
          <div className="text-sm text-gray-500">No service areas yet. Click <span className="font-medium">New Area</span> and start clicking on the map to draw.</div>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left column: controls */}
      <div className="lg:col-span-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Service Areas</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={startNewArea}
              className="px-3 py-2 rounded-lg bg-black text-white text-sm hover:opacity-90"
            >
              New Area
            </button>
          </div>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-10 bg-gray-100 rounded" />
            <div className="h-10 bg-gray-100 rounded" />
          </div>
        ) : (
          <AreaList />
        )}

        {mode === "drawing" && (
          <div className="border rounded-xl p-3 space-y-2">
            <div className="font-medium">Drawing new area…</div>
            <div className="text-xs text-gray-600">Click on the map to add points. You need at least 3 points. Use Undo to remove the last point.</div>
            <div className="flex gap-2 pt-1">
              <button onClick={undoVertex} className="px-3 py-1.5 border rounded-lg text-sm">Undo</button>
              <button onClick={clearDraft} className="px-3 py-1.5 border rounded-lg text-sm">Clear</button>
              <button
                onClick={finishDraft}
                disabled={draftPath.length < 3}
                className={`px-3 py-1.5 rounded-lg text-sm ${draftPath.length < 3 ? "bg-gray-100 text-gray-400 border border-gray-200" : "bg-black text-white"}`}
              >
                Finish & Save
              </button>
              <button onClick={() => setMode("idle")} className="px-3 py-1.5 border rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        )}

        {mode === "editing" && selectedArea && (
          <div className="border rounded-xl p-3 space-y-2">
            <div className="font-medium">Editing: {selectedArea.name ?? "Untitled area"}</div>
            <div className="text-xs text-gray-600">Drag vertices to adjust the shape. Add points by dragging midpoints.</div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={saveEditing}
                disabled={!editingDirty}
                className={`px-3 py-1.5 rounded-lg text-sm ${!editingDirty ? "bg-gray-100 text-gray-400 border border-gray-200" : "bg-black text-white"}`}
              >
                Save changes
              </button>
              <button onClick={cancelEditing} className="px-3 py-1.5 border rounded-lg text-sm">Close</button>
              <button onClick={deleteSelected} className="px-3 py-1.5 border rounded-lg text-sm text-red-600">Delete</button>
            </div>
          </div>
        )}
      </div>

      {/* Right column: map */}
      <div className="lg:col-span-8">
        {isLoaded ? (
          <GoogleMap
            onLoad={onMapLoad}
            onClick={handleMapClick}
            center={defaultCenter}
            zoom={12}
            mapContainerStyle={containerStyle}
            options={{
              mapTypeControl: false,
              streetViewControl: false,
              fullscreenControl: false,
            }}
          >
            {/* Existing areas */}
            {areas.map((a) => {
              const paths = gjToPaths(a.gj);
              const isSelected = selectedId === a.id && mode === "editing";
              return (
                <Polygon
                  key={a.id}
                  paths={paths[0] ?? []}
                  options={{
                    strokeWeight: 2,
                    strokeOpacity: 1,
                    fillOpacity: 0.1,
                    clickable: true,
                    editable: isSelected,
                    draggable: false,
                    zIndex: isSelected ? 2 : 1,
                  }}
                  onClick={() => selectArea(a.id)}
                  onLoad={onPolygonLoad}
                />
              );
            })}

            {/* Draft polygon preview while drawing */}
            {mode === "drawing" && draftPath.length > 0 && (
              <Polygon
                paths={draftPath}
                options={{
                  strokeWeight: 2,
                  strokeOpacity: 1,
                  fillOpacity: 0.05,
                  clickable: false,
                  editable: false,
                }}
              />
            )}
          </GoogleMap>
        ) : (
          <div className="h-[520px] flex items-center justify-center border rounded-xl bg-white">Loading map…</div>
        )}
      </div>
    </div>
  );
}
