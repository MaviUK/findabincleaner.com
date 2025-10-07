import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Polygon } from "@react-google-maps/api";

// ---------- Types ----------
type GJPoly = GeoJSON.Polygon | GeoJSON.MultiPolygon | null;

type Props = {
  initialGeoJSON?: GJPoly;
  onChange: (gj: GJPoly) => void;
  center?: google.maps.LatLngLiteral;
  zoom?: number;
};

// ---------- GeoJSON <-> Google helpers ----------
function gjToPaths(gj: GJPoly): google.maps.LatLngLiteral[][] {
  if (!gj) return [];

  if (gj.type === "Polygon") {
    const ring = gj.coordinates[0] ?? [];
    return [ring.map(([lng, lat]) => ({ lat, lng }))];
  }
  if (gj.type === "MultiPolygon") {
    return gj.coordinates.map((poly) =>
      (poly[0] ?? []).map(([lng, lat]) => ({ lat, lng }))
    );
  }
  return [];
}

function pathsToGJ(paths: google.maps.LatLngLiteral[][]): GJPoly {
  if (!paths.length || !paths[0]?.length) return null;

  if (paths.length === 1) {
    const ring = paths[0].map(({ lat, lng }) => [lng, lat]);
    // ensure closed ring
    if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
      ring.push(ring[0]);
    }
    return { type: "Polygon", coordinates: [ring] } as GeoJSON.Polygon;
  }

  const mps = paths.map((p) => {
    const ring = p.map(({ lat, lng }) => [lng, lat]);
    if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
      ring.push(ring[0]);
    }
    return [ring];
  });
  return { type: "MultiPolygon", coordinates: mps } as GeoJSON.MultiPolygon;
}

// ---------- Component ----------
export default function GoogleAreaDrawer({
  initialGeoJSON,
  onChange,
  center = { lat: 54.59, lng: -5.7 },
  zoom = 12,
}: Props) {
  const [paths, setPaths] = useState<google.maps.LatLngLiteral[][]>(() =>
    gjToPaths(initialGeoJSON ?? null)
  );

  const [drawing, setDrawing] = useState(false);      // click-to-add mode
  const [tempPath, setTempPath] = useState<google.maps.LatLngLiteral[]>([]);
  const mapRef = useRef<google.maps.Map | null>(null);

  // seed from initial
  useEffect(() => {
    setPaths(gjToPaths(initialGeoJSON ?? null));
  }, [initialGeoJSON]);

  // push changes up anytime 'paths' is edited
  useEffect(() => {
    onChange(pathsToGJ(paths));
  }, [paths, onChange]);

  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  // While drawing: add point on map click
  const handleMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!drawing) return;
      const latLng = e.latLng;
      if (!latLng) return;
      setTempPath((prev) => [...prev, { lat: latLng.lat(), lng: latLng.lng() }]);
    },
    [drawing]
  );

  // Double click ends drawing if we have >= 3 points
  const handleMapDblClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!drawing) return;
      e.domEvent.preventDefault();
      e.domEvent.stopPropagation();

      if (tempPath.length >= 3) {
        setPaths((prev) => (prev.length ? [...prev, tempPath] : [tempPath]));
        setTempPath([]);
        setDrawing(false);
      }
    },
    [drawing, tempPath]
  );

  // Edits from vertex dragging
  const handlePathSetAt = useCallback(
    (polyIdx: number) =>
      (_: number) => {
        const poly = polygonRefs.current[polyIdx];
        const newPaths = polygonRefs.current.map((p) => {
          const arr: google.maps.LatLngLiteral[] = [];
          if (!p?.getPath) return arr;
          const mvc = p.getPath();
          for (let i = 0; i < mvc.getLength(); i++) {
            const ll = mvc.getAt(i);
            arr.push({ lat: ll.lat(), lng: ll.lng() });
          }
          return arr;
        });
        setPaths(newPaths);
      },
    []
  );

  // Allow deleting a vertex with right-click (contextmenu)
  const handleRightClick = useCallback(
    (polyIdx: number) =>
      (e: google.maps.PolyMouseEvent) => {
        const path = [...paths[polyIdx]];
        const ll = e.latLng;
        if (!ll) return;
        const i = path.findIndex((p) => Math.abs(p.lat - ll.lat()) < 1e-7 && Math.abs(p.lng - ll.lng()) < 1e-7);
        if (i > -1) {
          path.splice(i, 1);
          const copy = paths.slice();
          copy[polyIdx] = path;
          setPaths(copy);
        }
      },
    [paths]
  );

  // Refs to polygons to read live vertices after drag-edit
  const polygonRefs = useRef<google.maps.Polygon[]>([]);
  polygonRefs.current = [];

  const setPolyRef = (idx: number) => (ref: google.maps.Polygon | null) => {
    if (ref) polygonRefs.current[idx] = ref;
  };

  // map options tuned for drawing
  const mapOptions = useMemo<google.maps.MapOptions>(
    () => ({
      disableDefaultUI: true,
      zoomControl: true,
      draggableCursor: drawing ? "crosshair" : undefined,
      disableDoubleClickZoom: drawing, // let dbl-click finish shape
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    }),
    [drawing]
  );

  return (
    <div className="relative w-full">
      {/* Simple controls */}
      <div className="absolute z-10 top-2 left-2 flex gap-2">
        {!drawing ? (
          <button
            type="button"
            className="px-3 py-1 rounded bg-white shadow border"
            onClick={() => {
              setTempPath([]);
              setDrawing(true);
            }}
          >
            Draw polygon
          </button>
        ) : (
          <button
            type="button"
            className="px-3 py-1 rounded bg-white shadow border"
            onClick={() => {
              setTempPath([]);
              setDrawing(false);
            }}
          >
            Cancel
          </button>
        )}

        <button
          type="button"
          className="px-3 py-1 rounded bg-white shadow border"
          onClick={() => {
            setPaths([]);
            setTempPath([]);
            onChange(null);
          }}
        >
          Clear
        </button>
      </div>

      <GoogleMap
        onLoad={onLoad}
        onClick={handleMapClick}
        onDblClick={handleMapDblClick}
        center={center}
        zoom={zoom}
        options={mapOptions}
        mapContainerStyle={{ height: 420, width: "100%" }}
      >
        {/* Existing polygons (each editable) */}
        {paths.map((p, idx) => (
          <Polygon
            key={idx}
            ref={setPolyRef(idx)}
            paths={p}
            options={{
              strokeColor: "#2563eb",
              fillColor: "#2563eb",
              fillOpacity: 0.2,
              strokeOpacity: 0.9,
              strokeWeight: 2,
              editable: true,
              draggable: false,
              zIndex: 1,
            }}
            onMouseUp={handlePathSetAt(idx)} // fires after vertex drag
            onRightClick={handleRightClick(idx)} // quick vertex delete
          />
        ))}

        {/* Temp drawing path while in drawing mode */}
        {drawing && tempPath.length > 0 && (
          <Polygon
            paths={tempPath}
            options={{
              strokeColor: "#16a34a",
              fillColor: "#16a34a",
              fillOpacity: 0.15,
              strokeOpacity: 0.8,
              strokeWeight: 2,
              editable: false,
              zIndex: 2,
            }}
          />
        )}
      </GoogleMap>

      <div className="mt-2 text-xs text-gray-600">
        {drawing
          ? "Click to add points; double-click to finish the polygon."
          : "Drag vertices to adjust shape. Right-click a vertex to remove it."}
      </div>
    </div>
  );
}
