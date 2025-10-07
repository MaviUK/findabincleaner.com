// src/components/GoogleAreaDrawer.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, DrawingManager, Polygon, useJsApiLoader } from "@react-google-maps/api";

type Props = {
  initialGeoJSON?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  onChange: (gj: GeoJSON.Polygon | GeoJSON.MultiPolygon | null) => void;
  center?: [number, number];
  zoom?: number;
};

// Helpers
const MAP_STYLE = { width: "100%", height: "420px" } as const;
const DEFAULT_CENTER: [number, number] = [54.59, -5.7];
const DEFAULT_ZOOM = 12;

function isPolygon(gj: any): gj is GeoJSON.Polygon {
  return gj && gj.type === "Polygon";
}
function isMultiPolygon(gj: any): gj is GeoJSON.MultiPolygon {
  return gj && gj.type === "MultiPolygon";
}

/** Convert google MVC path to a closed GeoJSON ring [lng,lat][] */
function pathToRing(path: google.maps.MVCArray<google.maps.LatLng>): number[][] {
  const ring: number[][] = [];
  for (let i = 0; i < path.getLength(); i++) {
    const pt = path.getAt(i);
    ring.push([+pt.lng().toFixed(6), +pt.lat().toFixed(6)]);
  }
  // close ring if needed
  if (
    ring.length &&
    (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return ring;
}

/** Serialize current drawn polygons to GeoJSON (Polygon or MultiPolygon) */
function serializePolysToGeoJSON(polys: google.maps.Polygon[]): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!polys.length) return null;

  const polyRings: number[][][][] = polys.map((poly) => {
    const rings: number[][][] = [];
    const paths = poly.getPaths();
    for (let i = 0; i < paths.getLength(); i++) {
      rings.push(pathToRing(paths.getAt(i)));
    }
    return rings; // Polygon = LinearRing[]
  });

  if (polyRings.length === 1) {
    return { type: "Polygon", coordinates: polyRings[0] } as GeoJSON.Polygon;
  }
  return { type: "MultiPolygon", coordinates: polyRings } as GeoJSON.MultiPolygon;
}

/** Convert GeoJSON Polygon/MultiPolygon to arrays of google paths */
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

/** Attach listeners so edits trigger re-emit */
function attachEditListeners(poly: google.maps.Polygon, onAnyChange: () => void) {
  const paths = poly.getPaths();
  for (let i = 0; i < paths.getLength(); i++) {
    const path = paths.getAt(i);
    path.addListener("set_at", onAnyChange);
    path.addListener("insert_at", onAnyChange);
    path.addListener("remove_at", onAnyChange);
  }
}

export default function GoogleAreaDrawer({
  initialGeoJSON = null,
  onChange,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
}: Props) {
  const libraries = useMemo(() => ["drawing"] as ("drawing")[], []);
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY as string,
    libraries,
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const drawingRef = useRef<google.maps.drawing.DrawingManager | null>(null);

  // keep track of drawn/loaded polygons
  const [polys, setPolys] = useState<google.maps.Polygon[]>([]);

  // emit helper
  const emitGeoJSON = () => {
    const gj = serializePolysToGeoJSON(polys);
    onChange(gj);
  };

  // Clear all polygons from map
  const clearAll = () => {
    polys.forEach((p) => p.setMap(null));
    setPolys([]);
    onChange(null);
  };

  // Seed initial geometry (once map is ready)
  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;
    if (!initialGeoJSON) {
      clearAll();
      return;
    }

    // Build polygons from initial GeoJSON (editable)
    const toAdd: google.maps.Polygon[] = [];
    const sets = gjToGooglePaths(initialGeoJSON);
    sets.forEach((rings) => {
      const gp = new google.maps.Polygon({
        paths: rings,
        strokeColor: "#2563eb",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: "#2563eb",
        fillOpacity: 0.08,
        editable: true,
        draggable: false,
        map: mapRef.current!,
      });
      attachEditListeners(gp, emitGeoJSON);
      toAdd.push(gp);
    });

    // Fit bounds
    const bounds = new google.maps.LatLngBounds();
    sets.forEach((rings) =>
      rings.forEach((ring) => ring.forEach((pt) => bounds.extend(new google.maps.LatLng(pt.lat, pt.lng))))
    );
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 40);

    setPolys((prev) => {
      // remove previous
      prev.forEach((p) => p.setMap(null));
      return toAdd;
    });

    // Emit the initial value (normalized)
    onChange(serializePolysToGeoJSON(toAdd));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, initialGeoJSON]);

  // When a new polygon is completed from the drawing manager
  const handlePolygonComplete = (poly: google.maps.Polygon) => {
    poly.setEditable(true);
    attachEditListeners(poly, emitGeoJSON);
    // Stop continuous drawing
    drawingRef.current?.setDrawingMode(null);

    setPolys((prev) => {
      const next = [...prev, poly];
      // emit after state update microtask
      queueMicrotask(() => onChange(serializePolysToGeoJSON(next)));
      return next;
    });
  };

  // Remove all polygons if component unmounts
  useEffect(() => {
    return () => {
      polys.forEach((p) => p.setMap(null));
    };
  }, [polys]);

  if (loadError) {
    return <div className="card card-pad text-red-600">Failed to load Google Maps.</div>;
  }

  if (!isLoaded) {
    return <div className="card card-pad">Loading map…</div>;
  }

  return (
    <div className="space-y-2">
      <GoogleMap
        mapContainerStyle={MAP_STYLE}
        center={{ lat: center[0], lng: center[1] }}
        zoom={zoom}
        options={{ mapTypeControl: false, streetViewControl: false }}
        onLoad={(m) => {
          // IMPORTANT: must return void here
          mapRef.current = m;
        }}
      >
        {/* Existing polygons (editable) */}
        {polys.length === 0 && initialGeoJSON &&
          gjToGooglePaths(initialGeoJSON).map((rings, i) => (
            <Polygon
              key={`seed-${i}`}
              paths={rings}
              options={{
                strokeColor: "#2563eb",
                strokeOpacity: 0.9,
                strokeWeight: 2,
                fillColor: "#2563eb",
                fillOpacity: 0.08,
                editable: false, // the seeded ones are replaced by actual polygon instances above
                clickable: false,
                draggable: false,
              }}
            />
          ))}

        {/* Drawing tools */}
        <DrawingManager
          onLoad={(dm) => {
            drawingRef.current = dm;
          }}
          onPolygonComplete={handlePolygonComplete}
          options={{
            drawingMode: null,
            drawingControl: true,
            drawingControlOptions: {
              drawingModes: [google.maps.drawing.OverlayType.POLYGON],
            },
            polygonOptions: {
              strokeColor: "#2563eb",
              strokeOpacity: 0.9,
              strokeWeight: 2,
              fillColor: "#2563eb",
              fillOpacity: 0.08,
              editable: true,
              draggable: false,
            },
          }}
        />
      </GoogleMap>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn"
          onClick={() => drawingRef.current?.setDrawingMode(google.maps.drawing.OverlayType.POLYGON)}
        >
          Draw Polygon
        </button>
        <button type="button" className="btn" onClick={clearAll}>
          Clear
        </button>
      </div>
    </div>
  );
}
