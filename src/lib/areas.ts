import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, MultiPolygon, Point } from "geojson";

export function findContainingAreaId(
  lat: number,
  lng: number,
  areas: { id: string; geometry: Feature<MultiPolygon> }[]
): string | null {
  const pt: Point = { type: "Point", coordinates: [lng, lat] };
  for (const a of areas) {
    if (a?.geometry && booleanPointInPolygon(pt, a.geometry as any)) {
      return a.id;
    }
  }
  return null;
}
