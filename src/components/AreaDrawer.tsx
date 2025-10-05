// src/components/AreaDrawer.tsx
import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, FeatureGroup, useMap } from 'react-leaflet';
import L, { FeatureGroup as LGFeatureGroup } from 'leaflet';
import 'leaflet-draw';

type Props = {
  initialGeoJSON?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  onChange: (gj: GeoJSON.Polygon | GeoJSON.MultiPolygon | null) => void;
  center?: [number, number];
  zoom?: number;
};

function DrawTools({ fgRef, onChange }: { fgRef: React.RefObject<LGFeatureGroup>, onChange: Props['onChange'] }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !fgRef.current) return;

    // draw only polygons
    const drawControl = new L.Control.Draw({
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: true,
          metric: true
        },
        marker: false,
        polyline: false,
        circle: false,
        circlemarker: false,
        rectangle: false,
      },
      edit: {
        featureGroup: fgRef.current,
        remove: true,
      },
    });

    map.addControl(drawControl as any);

    function emit() {
      const layers: GeoJSON.Polygon[] = [];
      fgRef.current!.eachLayer((layer: any) => {
        const gj = layer.toGeoJSON();
        if (gj?.geometry?.type === 'Polygon') layers.push(gj.geometry as GeoJSON.Polygon);
      });
      if (layers.length === 0) return onChange(null);
      if (layers.length === 1) return onChange(layers[0]);
      // union-as-multipolygon shape (just grouping — not geometric union)
      onChange({
        type: 'MultiPolygon',
        coordinates: layers.map(p => p.coordinates),
      } as GeoJSON.MultiPolygon);
    }

    map.on(L.Draw.Event.CREATED, (e: any) => {
      fgRef.current!.addLayer(e.layer);
      emit();
    });
    map.on(L.Draw.Event.EDITED, emit);
    map.on(L.Draw.Event.DELETED, emit);

    return () => {
      map.removeControl(drawControl as any);
      map.off(L.Draw.Event.CREATED);
      map.off(L.Draw.Event.EDITED);
      map.off(L.Draw.Event.DELETED);
    };
  }, [map, fgRef, onChange]);

  return null;
}

export default function AreaDrawer({
  initialGeoJSON,
  onChange,
  center = [54.59, -5.70],
  zoom = 12,
}: Props) {
  const fgRef = useRef<LGFeatureGroup>(null);

  // seed the existing geometry
  useEffect(() => {
    if (!fgRef.current || !initialGeoJSON) return;
    const layer = L.geoJSON(initialGeoJSON as any);
    layer.eachLayer(l => fgRef.current!.addLayer(l));
  }, [initialGeoJSON]);

  return (
    <MapContainer center={center} zoom={zoom} style={{ height: 420, width: '100%' }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors'
      />
      <FeatureGroup ref={fgRef} />
      <DrawTools fgRef={fgRef} onChange={onChange} />
    </MapContainer>
  );
}
