import { useEffect, useMemo, useState } from "react";
import {
  GoogleMap,
  useLoadScript,
  DrawingManager,
  Polygon as GPolygon,
} from "@react-google-maps/api";
import { supabase } from "../lib/supabase";

type Props = { cleanerId: string };

export default function ServiceAreaEditor({ cleanerId }: Props) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY as string,
    libraries: ["drawing"],
  });

  const [polys, setPolys] = useState<google.maps.LatLngLiteral[][]>([]);
  const center = useMemo(() => ({ lat: 54.6079, lng: -5.9264 }), []); // e.g. Belfast

  useEffect(() => {
    // Load existing polygons for this cleaner (optional, nice UX)
    (async () => {
      const { data, error } = await supabase
        .from("service_areas")
        .select("geom")
        .eq("cleaner_id", cleanerId);

      if (!error && data) {
        // Supabase returns GeoJSON-ish; convert to LatLng for <Polygon />
        const next: google.maps.LatLngLiteral[][] = [];
        for (const row of data as any[]) {
          // Expect MultiPolygon: { coordinates: [ [ [lng,lat], ... ] ] }
          const coords = row.geom?.coordinates?.[0]; // first polygon
          if (Array.isArray(coords)) {
            const ring: google.maps.LatLngLiteral[] = coords.map(
              ([lng, lat]: [number, number]) => ({ lat, lng })
            );
            next.push(ring);
          }
        }
        setPolys(next);
      }
    })();
  }, [cleanerId]);

  if (loadError) return <div>Failed to load Google Maps.</div>;
  if (!isLoaded) return <div>Loading map…</div>;

  const onPolygonComplete = async (poly: google.maps.Polygon) => {
    try {
      const path = poly.getPath();
      const coords: [number, number][] = [];

      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        coords.push([p.lng(), p.lat()]); // GeoJSON expects [lng,lat]
      }
     // Close the ring (avoid .at for ES2020)
if (coords.length) {
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coords.push(first);
  }
}


      const geojson = {
        type: "MultiPolygon",
        coordinates: [[coords]], // single polygon, single ring
      };

      const { error } = await supabase.rpc("insert_service_area", {
        cleaner_id: cleanerId,
        gj: geojson,
        name: "My Area",
      });

      if (error) {
        alert("Save failed: " + error.message);
      } else {
        // Show it on the map locally
        setPolys((prev) => [...prev, coords.map(([lng, lat]) => ({ lat, lng }))]);
        alert("Service area saved.");
      }
    } catch (e: any) {
      alert("Unexpected error: " + e.message);
    } finally {
      // Remove the editable polygon from the map after save
      poly.setMap(null);
    }
  };

  return (
    <div className="h-[70vh] w-full rounded-2xl overflow-hidden">
      <GoogleMap zoom={11} center={center} mapContainerClassName="w-full h-full">
        {/* Existing areas */}
        {polys.map((ring, i) => (
          <GPolygon key={i} paths={ring} options={{ editable: false }} />
        ))}

        {/* Draw new area */}
        <DrawingManager
  onPolygonComplete={onPolygonComplete}
  options={{
    drawingControl: true,
    drawingControlOptions: {
      drawingModes: [google.maps.drawing.OverlayType.POLYGON], // 👈 this
    },
    polygonOptions: {
      fillOpacity: 0.2,
      strokeWeight: 2,
      clickable: false,
      editable: false,
    },
  }}
/>

      </GoogleMap>
    </div>
  );
}
