import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Polygon, useJsApiLoader } from "@react-google-maps/api";
import { supabase } from "../lib/supabase";

/**
 * ServiceAreaEditor_v2 (custom drawing, no DrawingManager)
 * - Create: click to add vertices → Finish & Save (insert)
 * - Edit: select existing → polygon becomes editable → Save (update) / Delete
 * - Rename on create & edit; Save enables when name OR geometry changed
 * - Stores as GeoJSON MultiPolygon in service_areas.gj
 */

type Mode = "idle" | "drawing" | "editing";

interface ServiceAreaRow {
  id: string;
  cleaner_id: string;
  name: string | null;
  gj: any; // GeoJSON MultiPolygon
  created_at: string;
}

// ---------- Helpers: GeoJSON <-> Maps paths ----------
function gjToPaths(gj: any): google.maps.LatLngLiteral[][] {
  const out: google.maps.LatLngLiteral[][] = [];
  if (!gj || gj.type !== "MultiPolygon" || !Array.isArray(gj.coordinates)) return out;
  for (const polygon of gj.coordinates as number[][][][]) {
    const outer = polygon?.[0];
    if (!outer) continue;
    out.push(outer.map(([lng, lat]) => ({ lat, lng })));
  }
  return out;
}

function ensureClosedRing(ring: google.maps.LatLngLiteral[]): google.maps.LatLngLiteral[] {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first.lat === last.lat && first.lng === last.lng) return ring;
  return [...ring, first];
}

function pathsToMultiPolygonGeoJSON(paths: google.maps.LatLngLiteral[][]): any {
  const coords = paths.map((ring) => {
    const closed = ensureClosedRing(ring).map((pt) => [pt.lng, pt.lat]);
    return [closed];
  });
  return { type: "MultiPolygon", coordinates: coords };
}

// ---------- Map defaults ----------
const containerStyle: React.CSSProperties = { width: "100%", height: 520 };
const defaultCenter: google.maps.LatLngLiteral = { lat: 54.653, lng: -5.669 };

export default function ServiceAreaEditor({ cleanerId }: { cleanerId: string }) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "gmap-script",
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY as string,
  });

  const mapRef = useRef<google.maps.Map | null>(null);

  const [mode, setMode] = useState<Mode>("idle");
  const [areas, setAreas] = useState<ServiceAreaRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drawing draft
  const [draftPath, setDraftPath] = useState<google.maps.LatLngLiteral[]>([]);
  const [areaName, setAreaName] = useState<string>("");

  // Editing existing
  const [editingDirty, setEditingDirty] = useState(false);
  const [nameDirty, setNameDirty] = useState(false);
  const editedPathRef = useRef<google.maps.LatLngLiteral[] | null>(null);
  const selectedPolyRef = useRef<google.maps.Polygon | null>(null);

  // In editing mode, always allow saving (we'll read the live path on save as a fallback)
  const canSave = mode === "editing" ? true : (nameDirty || editingDirty);


  const selectedArea = useMemo(
    () => (selectedId ? areas.find((a) => a.id === selectedId) ?? null : null),
    [areas, selectedId]
  );

  // ---------- Load areas ----------
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

  // ---------- Fit bounds to first area ----------
  useEffect(() => {
    if (!isLoaded || !mapRef.current || areas.length === 0) return;
    const first = areas[0];
    const paths = gjToPaths(first.gj);
    const b = new google.maps.LatLngBounds();
    paths.flat().forEach((pt) => b.extend(pt));
    if (!b.isEmpty()) mapRef.current.fitBounds(b, 48);
  }, [isLoaded, areas]);

  // ---------- Map handlers ----------
  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const handleMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (mode !== "drawing") return;
      const pt = e.latLng?.toJSON();
      if (!pt) return;
      setDraftPath((prev) => [...prev, pt]);
    },
    [mode]
  );

  // ---------- Start / finish drawing ----------
  function startNewArea() {
    setMode("drawing");
    setSelectedId(null);
    setDraftPath([]);
    setEditingDirty(false);
    setNameDirty(false);
    setAreaName(`Service Area ${areas.length + 1}`);
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
    const nameToSave = areaName.trim() || defaultName;

    const { data, error } = await supabase.rpc("insert_service_area", {
      p_cleaner_id: cleanerId,
      p_gj: gj,
      p_name: nameToSave,
    });
    if (error) {
      setError(error.message);
      return;
    }
    setMode("idle");
    setDraftPath([]);
    setAreaName("");
    await loadAreas();
    setSelectedId((data as ServiceAreaRow)?.id ?? null);
  }

  // ---------- Select / edit existing ----------
  function selectArea(id: string) {
    setSelectedId(id);
    setMode("editing");
    setEditingDirty(false);
    setNameDirty(false);
    editedPathRef.current = null;

    const found = areas.find((a) => a.id === id) || null;
    setAreaName(found?.name ?? "");

    if (found && mapRef.current) {
      const b = new google.maps.LatLngBounds();
      gjToPaths(found.gj).flat().forEach((pt) => b.extend(pt));
      if (!b.isEmpty()) mapRef.current.fitBounds(b, 48);
    }
  }

  function cancelEditing() {
    setMode("idle");
    setSelectedId(null);
    setAreaName("");
    setEditingDirty(false);
    setNameDirty(false);
    editedPathRef.current = null;
  }

   async function saveEditing() {
    if (mode !== "editing" || !selectedId) return;
    const area = areas.find((a) => a.id === selectedId);
    if (!area) return;

    let gj = area.gj;

    if (editedPathRef.current && editedPathRef.current.length >= 3) {
      // geometry changed via listeners
      gj = pathsToMultiPolygonGeoJSON([editedPathRef.current]);
    } else if (selectedPolyRef.current) {
      // Fallback: read whatever is on the map right now
      const path = selectedPolyRef.current.getPath();
      const pts: google.maps.LatLngLiteral[] = [];
      for (let i = 0; i < path.getLength(); i++) {
        pts.push(path.getAt(i).toJSON());
      }
      if (pts.length >= 3) {
        gj = pathsToMultiPolygonGeoJSON([pts]);
      }
    }

    const nameToSave = areaName.trim() || "Service Area";
    const { error } = await supabase.rpc("update_service_area", {
      p_area_id: area.id,
      p_gj: gj,
      p_name: nameToSave,
    });
    if (error) {
      setError(error.message);
      return;
    }

    setEditingDirty(false);
    setNameDirty(false);
    editedPathRef.current = null;

    // Keep you in context: reload areas but stay on the same selection
    await loadAreas();
    setSelectedId(area.id);
  }

  // ---------- Polygon load (for editing) ----------
  const onPolygonLoad = useCallback(
  (poly: google.maps.Polygon) => {
    if (mode !== "editing" || !selectedArea) return;

    // ADD THIS:
    selectedPolyRef.current = poly;

    const path = poly.getPath();
    const updateRefFromPath = () => {
      const pts: google.maps.LatLngLiteral[] = [];
      for (let i = 0; i < path.getLength(); i++) {
        pts.push(path.getAt(i).toJSON());
      }
      editedPathRef.current = pts;
      setEditingDirty(true);
    };
    google.maps.event.addListener(path, "insert_at", updateRefFromPath);
    google.maps.event.addListener(path, "remove_at", updateRefFromPath);
    google.maps.event.addListener(path, "set_at", updateRefFromPath);
  },
  [mode, selectedArea]
);


  if (loadError) {
    return <div className="text-red-600">Failed to load Google Maps.</div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left column: controls */}
      <div className="lg:col-span-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Service Areas</h2>
          <button
            onClick={startNewArea}
            className="px-3 py-2 rounded-lg bg-black text-white text-sm hover:opacity-90"
          >
            New Area
          </button>
        </div>

        {error && <div className="text-sm text-red-600">{error}</div>}

        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-10 bg-gray-100 rounded" />
            <div className="h-10 bg-gray-100 rounded" />
          </div>
        ) : (
          <div className="space-y-2">
            {areas.map((a) => (
              <button
                key={a.id}
                onClick={() => selectArea(a.id)}
                className={`w-full text-left border rounded-xl px-3 py-2 hover:bg-gray-50 ${
                  selectedId === a.id ? "border-black bg-gray-50" : "border-gray-200"
                }`}
              >
                <div className="font-medium">{a.name ?? "Untitled area"}</div>
                <div className="text-xs text-gray-500">
                  Created {new Date(a.created_at).toLocaleString()}
                </div>
              </button>
            ))}
            {areas.length === 0 && (
              <div className="text-sm text-gray-500">
                No service areas yet. Click <span className="font-medium">New Area</span> and start
                clicking on the map to draw.
              </div>
            )}
        </div>
        )}

        {mode === "drawing" && (
          <div className="border rounded-xl p-3 space-y-3">
            <div className="font-medium">Drawing new area…</div>
            <div className="text-xs text-gray-600">
              Click on the map to add points. You need at least 3 points. Use Undo to remove the
              last point.
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={areaName}
                onChange={(e) => setAreaName(e.target.value)}
                placeholder="Area name"
                className="flex-1 border rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={undoVertex} className="px-3 py-1.5 border rounded-lg text-sm">
                Undo
              </button>
              <button onClick={clearDraft} className="px-3 py-1.5 border rounded-lg text-sm">
                Clear
              </button>
              <button
                onClick={finishDraft}
                disabled={draftPath.length < 3}
                className={`px-3 py-1.5 rounded-lg text-sm ${
                  draftPath.length < 3
                    ? "bg-gray-100 text-gray-400 border border-gray-200"
                    : "bg-black text-white"
                }`}
              >
                Finish &amp; Save
              </button>
              <button onClick={() => setMode("idle")} className="px-3 py-1.5 border rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {mode === "editing" && selectedArea && (
          <div className="border rounded-xl p-3 space-y-3">
            <div className="font-medium">Editing area</div>
            <input
              type="text"
              value={areaName}
              onChange={(e) => { setAreaName(e.target.value); setNameDirty(true); }}
              placeholder="Area name"
              className="w-full border rounded-lg px-3 py-1.5 text-sm"
            />
            <div className="text-xs text-gray-600">
              Drag vertices to adjust the shape. Add points by dragging midpoints.
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={saveEditing}
                disabled={!canSave}
                className={`px-3 py-1.5 rounded-lg text-sm ${
                  !canSave ? "bg-gray-100 text-gray-400 border border-gray-200" : "bg-black text-white"
                }`}
              >
                Save changes
              </button>
              <button onClick={cancelEditing} className="px-3 py-1.5 border rounded-lg text-sm">
                Close
              </button>
              <button onClick={deleteSelected} className="px-3 py-1.5 border rounded-lg text-sm text-red-600">
                Delete
              </button>
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
          <div className="h-[520px] flex items-center justify-center border rounded-xl bg-white">
            Loading map…
          </div>
        )}
      </div>
    </div>
  );
}
