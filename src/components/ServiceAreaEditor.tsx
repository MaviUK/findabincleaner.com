// src/components/ServiceAreaEditor.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, Polygon, DrawingManager, useJsApiLoader } from "@react-google-maps/api";
import { supabase } from "../lib/supabase";
import AreaSponsorModal from "./AreaSponsorModal";
import AreaManageModal from "./AreaManageModal";

/** ServiceAreaEditor – draw/edit areas and show sponsor/manage CTAs */

// ---- Types ----
export interface ServiceAreaRow {
  id: string;
  business_id: string; // owner of the area (same UUID as cleaner_id in older code)
  name: string;
  gj: any; // GeoJSON MultiPolygon
  created_at: string;
}

type SlotState = {
  slot: 1 | 2 | 3;
  taken: boolean;
  status: string | null;
  owner_business_id: string | null;
};

// We’ll normalize server responses so `slots` is always an array in state
type SponsorshipState = {
  area_id: string;
  slots: SlotState[];
  paint?: { tier: 0 | 1 | 2 | 3; fill: string; stroke: string } | undefined;
};
type SponsorshipMap = Record<string, SponsorshipState | undefined>;

type Libraries = ("drawing" | "geometry" | "places")[];

const MAP_CONTAINER = { width: "100%", height: "600px" } as const;
const DEFAULT_CENTER = { lat: 54.607868, lng: -5.926437 };
const DEFAULT_ZOOM = 10;

const polyStyle: google.maps.PolygonOptions = {
  strokeWeight: 2,
  strokeOpacity: 0.9,
  fillOpacity: 0.35,
  clickable: true,
  editable: true,
  draggable: false,
};

const round = (n: number, p = 5) => Number(n.toFixed(p));

function pathToGeoJSONRing(
  path: google.maps.MVCArray<google.maps.LatLng> | google.maps.LatLng[]
): number[][] {
  const ring: number[][] = [];
  const len = (path as any).getLength
    ? (path as any).getLength()
    : (path as google.maps.LatLng[]).length;
  for (let i = 0; i < len; i++) {
    const pt: google.maps.LatLng = (path as any).getAt
      ? (path as any).getAt(i)
      : (path as google.maps.LatLng[])[i];
    ring.push([round(pt.lng()), round(pt.lat())]);
  }
  if (
    ring.length &&
    (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return ring;
}

function makeMultiPolygon(polys: google.maps.Polygon[]): any {
  const coordinates: number[][][][] = polys.map((poly) => {
    const rings: number[][][] = [];
    const paths = poly.getPaths();
    for (let i = 0; i < paths.getLength(); i++) {
      rings.push(pathToGeoJSONRing(paths.getAt(i)));
    }
    return rings;
  });
  return { type: "MultiPolygon", coordinates };
}

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

function polygonAreaMeters(p: google.maps.Polygon): number {
  let area = 0;
  const paths = p.getPaths();
  for (let i = 0; i < paths.getLength(); i++) {
    const path = paths.getAt(i);
    const arr: google.maps.LatLng[] = [];
    for (let j = 0; j < path.getLength(); j++) arr.push(path.getAt(j));
    const ringArea = google.maps.geometry.spherical.computeArea(arr);
    area += i === 0 ? Math.abs(ringArea) : -Math.abs(ringArea);
  }
  return Math.max(0, area);
}

function totalAreaMeters(polys: google.maps.Polygon[]): number {
  return polys.reduce((sum, p) => sum + polygonAreaMeters(p), 0);
}

function fmtArea(m2: number) {
  const hectares = m2 / 10_000;
  const km2 = m2 / 1_000_000;
  return `${km2.toFixed(2)} km² (${hectares.toFixed(1)} ha)`;
}

/** Accept Polygon/MultiPolygon/Feature/FeatureCollection and return array of rings-paths for <Polygon /> */
function geoToPaths(geo: any): { paths: { lat: number; lng: number }[][] }[] {
  if (!geo) return [];

  // FeatureCollection
  if (geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
    return geo.features.flatMap((f: any) => geoToPaths(f));
  }

  // Feature
  if (geo.type === "Feature" && geo.geometry) {
    return geoToPaths(geo.geometry);
  }

  // Geometry
  if (geo.type === "MultiPolygon" && Array.isArray(geo.coordinates)) {
    return (geo.coordinates as number[][][][]).map((poly) => ({
      paths: poly.map((ring) =>
        ring.map((pair) => {
          const [a, b] = pair;
          const lng = typeof a === "number" && typeof b === "number" ? a : (pair as any)[0];
          const lat = typeof a === "number" && typeof b === "number" ? b : (pair as any)[1];
          return { lat, lng };
        })
      ),
    }));
  }

  if (geo.type === "Polygon" && Array.isArray(geo.coordinates)) {
    return [
      {
        paths: (geo.coordinates as number[][][]).map((ring) =>
          ring.map((pair) => {
            const [a, b] = pair;
            const lng = typeof a === "number" && typeof b === "number" ? a : (pair as any)[0];
            const lat = typeof a === "number" && typeof b === "number" ? b : (pair as any)[1];
            return { lat, lng };
          })
        ),
      },
    ];
  }

  if (geo.geometry) return geoToPaths(geo.geometry);
  if (geo.geojson) return geoToPaths(geo.geojson);
  if (geo.multi) return geoToPaths(geo.multi);

  return [];
}

type Props = {
  /** Accept either prop name to keep the rest of the app compiling */
  businessId?: string;
  cleanerId?: string;
  sponsorshipVersion?: number;
  /** Optional: parent can intercept Manage clicks. If omitted, a centered AreaManageModal opens. */
  onSlotAction?: (area: { id: string; name?: string }, slot: 1 | 2 | 3) => void | Promise<void>;
};

// ---------------- Component ----------------
export default function ServiceAreaEditor({
  businessId,
  cleanerId,
  sponsorshipVersion = 0,
  onSlotAction,
}: Props) {
  // unified id used everywhere internally
  const myBusinessId = (businessId ?? cleanerId)!;

  const libraries = useMemo<Libraries>(() => ["drawing", "geometry"], []);
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY as string,
    libraries,
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const drawingMgrRef = useRef<google.maps.drawing.DrawingManager | null>(null);
  const [serviceAreas, setServiceAreas] = useState<ServiceAreaRow[]>([]);
  const [sponsorship, setSponsorship] = useState<SponsorshipMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string>("");
  const [draftPolys, setDraftPolys] = useState<google.maps.Polygon[]>([]);
  const [creating, setCreating] = useState<boolean>(false);

  // sponsor modal state
  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [sponsorAreaId, setSponsorAreaId] = useState<string | null>(null);
  const [sponsorSlot, setSponsorSlot] = useState<1 | 2 | 3>(1);

  // manage modal state (used when onSlotAction isn't provided)
  const [manageOpen, setManageOpen] = useState(false);
  const [manageAreaId, setManageAreaId] = useState<string | null>(null);
  const [manageSlot, setManageSlot] = useState<1 | 2 | 3>(1);

  // ---- PREVIEW OVERLAY (clipped purchasable sub-region) ----
  const [previewGeo, setPreviewGeo] = useState<any | null>(null);
  const clearPreview = useCallback(() => setPreviewGeo(null), []);
  const drawPreview = useCallback((multi: any) => setPreviewGeo(multi ?? null), []);
  const previewPolys = useMemo(() => geoToPaths(previewGeo), [previewGeo]);
  const previewActiveForArea = sponsorOpen && !!previewPolys.length && !!sponsorAreaId;

  const resetDraft = useCallback(() => {
    draftPolys.forEach((p) => p.setMap(null));
    setDraftPolys([]);
    setDraftName("");
    setActiveAreaId(null);
    setCreating(false);
  }, [draftPolys]);

  // Fetch areas (RPC still uses p_cleaner_id; we pass the business id value)
  const fetchAreas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc("list_service_areas", { p_cleaner_id: myBusinessId });
      if (error) throw error;
      setServiceAreas(data || []);
    } catch (e: any) {
      setError(e.message || "Failed to load service areas");
    } finally {
      setLoading(false);
    }
  }, [myBusinessId]);

  useEffect(() => {
    if (!myBusinessId) return;
    fetchAreas();
  }, [fetchAreas, myBusinessId]);

  // ------- SLOTS NORMALIZATION (robust to different server shapes) -------
  const fetchSponsorship = useCallback(async (areaIds: string[]) => {
    if (!areaIds.length) return;
    try {
      const res = await fetch("/.netlify/functions/area-sponsorship", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ areaIds }),
      });
      if (!res.ok) throw new Error(`sponsorship ${res.status}`);

      const raw: { areas: Array<any> } = await res.json();

      const map: SponsorshipMap = {};
      for (const a of raw.areas || []) {
        const rawSlots = a.slots;

        let slotsArray: SlotState[] = [];

        if (Array.isArray(rawSlots)) {
          // already an array of slots
          slotsArray = rawSlots.map((s: any) => ({
            slot: s.slot as 1 | 2 | 3,
            taken: Boolean(s.taken),
            status: s.status ?? null,
            // accept both field names from various backends
            owner_business_id: s.owner_business_id ?? s.by_business_id ?? null,
          }));
        } else if (rawSlots && typeof rawSlots === "object") {
          // object keyed by "1"/"2"/"3"
          slotsArray = Object.values(rawSlots).map((s: any) => ({
            slot: (s.slot ?? Number(s?.slot ?? s?.id ?? s?.key)) as 1 | 2 | 3,
            taken: Boolean(s.taken),
            status: s.status ?? null,
            owner_business_id: s.owner_business_id ?? s.by_business_id ?? null,
          }));
        } else {
          // nothing from server -> provide empty placeholders (all available)
          slotsArray = [1, 2, 3].map((n) => ({
            slot: n as 1 | 2 | 3,
            taken: false,
            status: null,
            owner_business_id: null,
          }));
        }

        // Ensure we have entries for 1,2,3 (in case server omitted some)
        const bySlot = new Map<number, SlotState>();
        for (const s of slotsArray) bySlot.set(s.slot, s);
        slotsArray = [1, 2, 3].map((n) => {
          const s = bySlot.get(n);
          return (
            s ?? {
              slot: n as 1 | 2 | 3,
              taken: false,
              status: null,
              owner_business_id: null,
            }
          );
        });

        map[a.area_id] = {
          area_id: a.area_id,
          slots: slotsArray,
          paint: a.paint,
        };
      }

      setSponsorship(map);
    } catch (e) {
      console.warn("[ServiceAreaEditor] area-sponsorship fetch failed:", e);
      setSponsorship({});
    }
  }, []);
  // -----------------------------------------------------------------------

  useEffect(() => {
    fetchSponsorship(serviceAreas.map((a) => a.id));
  }, [fetchSponsorship, serviceAreas, sponsorshipVersion]);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const onDrawingLoad = useCallback((dm: google.maps.drawing.DrawingManager) => {
    drawingMgrRef.current = dm;
  }, []);

  const onPolygonComplete = useCallback((poly: google.maps.Polygon) => {
    poly.setOptions(polyStyle);
    poly.setEditable(true);
    drawingMgrRef.current?.setDrawingMode(null);
    setDraftPolys((prev) => [...prev, poly]);
  }, []);

  const startNewArea = useCallback(() => {
    resetDraft();
    clearPreview(); // ensure preview is not visible while drawing
    setCreating(true);
    setDraftName("New Service Area");
    setTimeout(
      () => drawingMgrRef.current?.setDrawingMode(google.maps.drawing.OverlayType.POLYGON),
      0
    );
  }, [resetDraft, clearPreview]);

  const editArea = useCallback(
    (area: ServiceAreaRow) => {
      resetDraft();
      clearPreview(); // ensure preview isn’t lingering while editing
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
    [resetDraft, clearPreview]
  );

  const saveDraft = useCallback(async () => {
    if (!draftPolys.length) {
      setError("Draw at least one polygon.");
      return;
    }
    const multi = makeMultiPolygon(draftPolys);

    const newKey = normalizeMultiPolygon(multi);
    const dup = serviceAreas.find(
      (a) => normalizeMultiPolygon(a.gj)
