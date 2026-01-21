// src/components/ServiceAreaEditor.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleMap,
  Polygon,
  DrawingManager,
  useJsApiLoader,
} from "@react-google-maps/api";
import { supabase } from "../lib/supabase";
import AreaSponsorModal from "./AreaSponsorModal";
import AreaManageModal from "./AreaManageModal";
import DeleteAreaModal from "./DeleteAreaModal";

/** ServiceAreaEditor – draw/edit areas and show sponsor/manage CTAs (single Featured slot) */

export interface ServiceAreaRow {
  id: string;
  cleaner_id: string;
  category_id: string | null;
  name: string;
  gj: any; // GeoJSON MultiPolygon
  created_at: string;

  // ✅ NEW: server-calculated area in km² (PostGIS ST_Area(geom::geography)/1e6)
  km2?: number | null;

  // lock info (from RPC)
  is_sponsored_locked?: boolean;
  sponsored_until?: string | null;
}

type Slot = 1;

type SingleSlotState = {
  taken: boolean;
  status: string | null;
  owner_business_id: string | null;

  // purchased portion (GeoJSON)
  sponsored_geojson?: any | null;
};

type SponsorshipState = {
  area_id: string;
  slot: SingleSlotState;
  sponsored_geojson?: any | null;
  paint?: { tier: 0 | 1 | 2 | 3; fill: string; stroke: string };
};

type SponsorshipMap = Record<string, SponsorshipState | undefined>;
type Libraries = ("drawing" | "geometry")[];

const isBlockingStatus = (s?: string | null) =>
  ["active", "trialing", "past_due"].includes((s || "").toLowerCase());

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
    (ring[0][0] !== ring[ring.length - 1][0] ||
      ring[0][1] !== ring[ring.length - 1][1])
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
  const polys = (multi.coordinates as number[][][][]).map(
    (rings: number[][][]) =>
      rings
        .map((ring: number[][]) =>
          ring.map(([lng, lat]) => [round(lng, 5), round(lat, 5)])
        )
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

/** Parse JSON if string, otherwise pass through */
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

/**
 * Heuristic: try to interpret coordinate pairs as [lng,lat] (GeoJSON standard),
 * BUT if it looks like UK [lat,lng] (lat ~ 49..61, lng ~ -11..4), swap.
 */
function pairToLatLng(pair: any): { lat: number; lng: number } | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;

  const a = Number(pair[0]);
  const b = Number(pair[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  // UK-ish detection: lat ~ 49..61, lng ~ -11..4
  const aLooksLikeLatUK = a >= 49 && a <= 61;
  const bLooksLikeLngUK = b >= -11 && b <= 4;

  const bLooksLikeLatUK = b >= 49 && b <= 61;
  const aLooksLikeLngUK = a >= -11 && a <= 4;

  // If it "strongly" looks like [lat,lng], swap
  if (aLooksLikeLatUK && bLooksLikeLngUK && !bLooksLikeLatUK) {
    return { lat: a, lng: b };
  }
  if (bLooksLikeLatUK && aLooksLikeLngUK && !aLooksLikeLatUK) {
    return { lat: b, lng: a };
  }

  // Default: GeoJSON [lng,lat]
  return { lat: b, lng: a };
}

/** Accept Polygon/MultiPolygon/Feature/FeatureCollection and return array of rings-paths for <Polygon /> */
function geoToPaths(geoInput: any): { paths: { lat: number; lng: number }[][] }[] {
  const geo = maybeParseGeo(geoInput);
  if (!geo) return [];

  if (geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
    return geo.features.flatMap((f: any) => geoToPaths(f));
  }

  if (geo.type === "Feature" && geo.geometry) {
    return geoToPaths(geo.geometry);
  }

  if (geo.type === "MultiPolygon" && Array.isArray(geo.coordinates)) {
    return (geo.coordinates as any[]).map((poly: any) => ({
      paths: (poly as any[]).map((ring: any[]) =>
        ring
          .map((pair: any) => pairToLatLng(pair))
          .filter(Boolean) as { lat: number; lng: number }[]
      ),
    }));
  }

  if (geo.type === "Polygon" && Array.isArray(geo.coordinates)) {
    return [
      {
        paths: (geo.coordinates as any[]).map((ring: any[]) =>
          ring
            .map((pair: any) => pairToLatLng(pair))
            .filter(Boolean) as { lat: number; lng: number }[]
        ),
      },
    ];
  }

  if (geo.geometry) return geoToPaths(geo.geometry);
  if (geo.geojson) return geoToPaths(geo.geojson);
  if (geo.multi) return geoToPaths(geo.multi);

  return [];
}

/** ⚠️ Client area calc is NOT source-of-truth. Only used as a fallback if km2 missing. */
function geoMultiPolygonAreaKm2(gjInput: any): number {
  const gj = maybeParseGeo(gjInput);
  if (!gj || gj.type !== "MultiPolygon" || !Array.isArray(gj.coordinates)) return 0;

  let totalM2 = 0;
  for (const poly of gj.coordinates as number[][][][]) {
    for (let ringIndex = 0; ringIndex < poly.length; ringIndex++) {
      const ring = poly[ringIndex];
      const path = ring
        .map((pair: any) => pairToLatLng(pair))
        .filter(Boolean)
        .map((p) => new google.maps.LatLng(p!.lat, p!.lng));

      const ringM2 = google.maps.geometry.spherical.computeArea(path);
      totalM2 += ringIndex === 0 ? Math.abs(ringM2) : -Math.abs(ringM2);
    }
  }
  return Math.max(0, totalM2) / 1_000_000;
}

function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;

  let parent: HTMLElement | null = el.parentElement;

  while (parent) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    const canScroll =
      (overflowY === "auto" || overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight;

    if (canScroll) return parent;
    parent = parent.parentElement;
  }

  return document.scrollingElement as HTMLElement; // fallback
}

type Props = {
  businessId?: string;
  cleanerId?: string;
  categoryId?: string | null;
  sponsorshipVersion?: number;
  onSlotAction?: (area: { id: string; name?: string }, slot: Slot) => void | Promise<void>;
};

type AvailMap = Record<string, boolean | undefined>;
type AvailLoadingMap = Record<string, boolean>;
type CategoryRow = { id: string; name: string; slug: string | null };

export default function ServiceAreaEditor({
  businessId,
  cleanerId,
  categoryId = null,
  sponsorshipVersion = 0,
  onSlotAction,
}: Props) {
  // viewer business id (may be empty on public/other business pages)
  const myBusinessId = (businessId ?? cleanerId) || "";

  const libraries = useMemo<Libraries>(() => ["drawing", "geometry"], []);
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_KEY as string,
    libraries,
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const drawingMgrRef = useRef<google.maps.drawing.DrawingManager | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);

  const [serviceAreas, setServiceAreas] = useState<ServiceAreaRow[]>([]);
  const [sponsorship, setSponsorship] = useState<SponsorshipMap>({});
  // ✅ Category-wide sponsored polygons (other businesses)
  const [categorySponsored, setCategorySponsored] = useState<any[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [avail, setAvail] = useState<AvailMap>({});
  const [availLoading, setAvailLoading] = useState<AvailLoadingMap>({});

  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string>("");
  const [draftPolys, setDraftPolys] = useState<google.maps.Polygon[]>([]);
  const [creating, setCreating] = useState<boolean>(false);

  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [sponsorAreaId, setSponsorAreaId] = useState<string | null>(null);

  const [manageOpen, setManageOpen] = useState(false);
  const [manageAreaId, setManageAreaId] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteAreaId, setDeleteAreaId] = useState<string | null>(null);
  const [deleteAreaName, setDeleteAreaName] = useState<string>("");
  const [deleteIsSponsoredByMe, setDeleteIsSponsoredByMe] = useState<boolean>(false);

  const [previewGeo, setPreviewGeo] = useState<any | null>(null);
  const clearPreview = useCallback(() => setPreviewGeo(null), []);
  const drawPreview = useCallback((multi: any) => setPreviewGeo(multi ?? null), []);
  const previewPolys = useMemo(() => geoToPaths(previewGeo), [previewGeo]);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyArea, setCopyArea] = useState<ServiceAreaRow | null>(null);
  const [copyTargetCategoryId, setCopyTargetCategoryId] = useState<string>("");
  const [copyName, setCopyName] = useState<string>("");
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyErr, setCopyErr] = useState<string | null>(null);

  // ✅ helper: source-of-truth km² display
  const areaKm2 = useCallback(
    (a: ServiceAreaRow) => {
      const dbKm2 = Number(a.km2);
      if (Number.isFinite(dbKm2) && dbKm2 > 0) return dbKm2;
      // fallback only (should disappear once list_service_areas returns km2)
      if (!isLoaded) return 0;
      return geoMultiPolygonAreaKm2(a.gj);
    },
    [isLoaded]
  );

  // categories (only meaningful when logged in / myBusinessId known)
  useEffect(() => {
    if (!myBusinessId) return;

    (async () => {
      const { data, error } = await supabase.rpc("list_active_categories_for_cleaner", {
        p_cleaner_id: myBusinessId,
      });

      if (error) {
        console.warn("active categories fetch error:", error);
        setCategories([]);
        return;
      }

      setCategories((data as any) || []);
    })();
  }, [myBusinessId]);

  useEffect(() => {
    setSponsorship({});
    setAvail({});
    setAvailLoading({});
    setPreviewGeo(null);
    setSponsorOpen(false);
    setSponsorAreaId(null);
    setManageOpen(false);
    setManageAreaId(null);

    setCopyOpen(false);
    setCopyArea(null);
    setCopyTargetCategoryId("");
    setCopyName("");
    setCopyErr(null);
  }, [categoryId]);

  const resetDraft = useCallback(() => {
    draftPolys.forEach((p) => p.setMap(null));
    setDraftPolys([]);
    setDraftName("");
    setActiveAreaId(null);
    setCreating(false);
  }, [draftPolys]);

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
      setServiceAreas((data as any) || []);
    } catch (e: any) {
      setError(e.message || "Failed to load service areas");
    } finally {
      setLoading(false);
    }
  }, [myBusinessId, categoryId]);

  useEffect(() => {
    if (!myBusinessId) return;
    fetchAreas();
  }, [fetchAreas, myBusinessId]);

  // paint tokens
  const OWNED_BY_ME_PAINT = {
    tier: 3,
    fill: "rgba(245, 158, 11, 0.28)", // amber (mine)
    stroke: "#f59e0b",
  } as const;

  const OWNED_BY_OTHER_PAINT = {
    tier: 2,
    fill: "rgba(239, 68, 68, 0.30)", // red (others / owned)
    stroke: "#dc2626",
  } as const;

  function isOwnedSlot(slot: SingleSlotState | null) {
    return !!slot && slot.taken && isBlockingStatus(slot.status);
  }

  function ownedPaintFor(slot: SingleSlotState | null, bizId: string) {
    if (!isOwnedSlot(slot)) return undefined;

    if (!bizId) return OWNED_BY_OTHER_PAINT;

    const isMine = slot?.owner_business_id === bizId;
    return isMine ? OWNED_BY_ME_PAINT : OWNED_BY_OTHER_PAINT;
  }

  const fetchSponsorship = useCallback(
    async (areaIds: string[]) => {
      if (!areaIds.length) return;

      try {
        const res = await fetch("/.netlify/functions/area-sponsorship", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            areaIds,
            categoryId,
          }),
        });

        if (!res.ok) throw new Error(`sponsorship ${res.status}`);

        const raw: { areas: Array<any> } = await res.json();
        const map: SponsorshipMap = {};

        for (const a of raw.areas || []) {
          let slot: SingleSlotState | null = null;

          if (Array.isArray(a.slots)) {
            const s1 = a.slots.find((s: any) => Number(s?.slot) === 1);
            if (s1) {
              slot = {
                taken: Boolean(s1.taken),
                status: s1.status ?? null,
                owner_business_id:
                  s1.owner_business_id ?? s1.by_business_id ?? s1.business_id ?? null,
                sponsored_geojson: s1.sponsored_geojson ?? null,
              };
            }
          }

          if (!slot) {
            slot = {
              taken: Boolean(a.taken),
              status: a.status ?? null,
              owner_business_id: a.owner_business_id ?? a.business_id ?? null,
              sponsored_geojson: a.sponsored_geojson ?? null,
            };
          }

          const paint = ownedPaintFor(slot, myBusinessId);

          map[a.area_id] = {
            area_id: a.area_id,
            slot,
            sponsored_geojson: slot?.sponsored_geojson ?? a.sponsored_geojson ?? null,
            paint,
          };
        }

        setSponsorship(map);
      } catch (e) {
        console.warn("[ServiceAreaEditor] area-sponsorship fetch failed:", e);
        setSponsorship({});
      }
    },
    [myBusinessId, categoryId]
  );

  useEffect(() => {
    const ids = serviceAreas.map((a) => a.id);
    fetchSponsorship(ids);
  }, [fetchSponsorship, serviceAreas, sponsorshipVersion]);

  useEffect(() => {
    if (!categoryId) {
      setCategorySponsored([]);
      return;
    }

    (async () => {
      try {
        const res = await fetch("/.netlify/functions/category-sponsored-geo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ categoryId }),
        });

        if (!res.ok) throw new Error(`category-sponsored-geo ${res.status}`);

        const j = await res.json();
        setCategorySponsored(Array.isArray(j?.features) ? j.features : []);
      } catch (e) {
        console.warn("[ServiceAreaEditor] category-sponsored-geo failed:", e);
        setCategorySponsored([]);
      }
    })();
  }, [categoryId, sponsorshipVersion]);

  const guardCanPurchaseSponsor = useCallback(
    async (areaId: string) => {
      if (!myBusinessId) {
        setError("Please log in to sponsor an area.");
        return false;
      }
      if (!categoryId) {
        setError("Please select an industry first.");
        return false;
      }

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId: myBusinessId,
            cleanerId: myBusinessId,
            areaId,
            slot: 1,
            categoryId,
          }),
        });

        if (!res.ok) {
          setError("Could not check sponsorship availability. Please try again.");
          return false;
        }

        const j = await res.json();

        if (!j?.ok) {
          setError(j?.reason || "This sponsorship is not available.");
          return false;
        }

        const soldOut = Boolean(j?.sold_out);
        const km2 = Number(j?.available_km2 ?? j?.remaining_km2 ?? j?.area_km2 ?? 0);
        const hasRemaining = !soldOut && Number.isFinite(km2) ? km2 > 0 : false;

        if (!hasRemaining) {
          setError("No purchasable region available (sold out).");
          return false;
        }

        return true;
      } catch (e) {
        console.warn("[guardCanPurchaseSponsor] preview check failed:", e);
        setError("Could not check sponsorship availability. Please try again.");
        return false;
      }
    },
    [myBusinessId, categoryId]
  );

  const computeAvailabilityForArea = useCallback(
    async (areaId: string) => {
      if (!areaId || !myBusinessId) return;

      setAvailLoading((m) => ({ ...m, [areaId]: true }));
      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId: myBusinessId,
            cleanerId: myBusinessId,
            areaId,
            slot: 1,
            categoryId,
          }),
        });

        if (!res.ok) {
          setAvail((m) => ({ ...m, [areaId]: undefined }));
          return;
        }

        const j = await res.json();
        if (!j || !j.ok) {
          setAvail((m) => ({ ...m, [areaId]: undefined }));
          return;
        }

        const rawKm2 = j.available_km2 ?? j.area_km2 ?? j.remaining_km2 ?? 0;
        const km2 = Number(rawKm2);
        const soldOut = Boolean(j.sold_out);
        const hasRemaining = !soldOut && Number.isFinite(km2) ? km2 > 0 : false;

        setAvail((m) => ({ ...m, [areaId]: hasRemaining }));
      } finally {
        setAvailLoading((m) => ({ ...m, [areaId]: false }));
      }
    },
    [myBusinessId, categoryId]
  );

  useEffect(() => {
    serviceAreas.forEach((a) => computeAvailabilityForArea(a.id));
  }, [serviceAreas, sponsorshipVersion, computeAvailabilityForArea]);

  const onMapLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const scrollToMapOnMobile = useCallback(() => {
    if (typeof window === "undefined") return;

    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (!isMobile) return;

    const target = mapWrapRef.current;
    if (!target) return;

    window.setTimeout(() => {
      const scroller = getScrollParent(target);

      if (scroller && scroller !== document.scrollingElement) {
        const scrollerRect = scroller.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();

        const top = targetRect.top - scrollerRect.top + scroller.scrollTop;
        scroller.scrollTo({ top: Math.max(0, top - 80), behavior: "smooth" });
        return;
      }

      const pageTop = window.scrollY + target.getBoundingClientRect().top;
      window.scrollTo({ top: Math.max(0, pageTop - 80), behavior: "smooth" });
    }, 350);
  }, []);

  const zoomToArea = useCallback(
    (area: ServiceAreaRow) => {
      if (!isLoaded || !mapRef.current) return;

      const gj = maybeParseGeo(area?.gj);
      if (!gj?.coordinates) return;

      const bounds = new google.maps.LatLngBounds();

      const polys: any[] =
        gj.type === "Polygon" ? [gj.coordinates as any] : (gj.coordinates as any);

      polys.forEach((rings: any[]) => {
        rings.forEach((ring: any[]) => {
          ring.forEach((pair: any) => {
            const p = pairToLatLng(pair);
            if (p) bounds.extend(new google.maps.LatLng(p.lat, p.lng));
          });
        });
      });

      if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 60);
    },
    [isLoaded]
  );

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
    clearPreview();
    setCreating(true);
    setDraftName("New Service Area");
    setTimeout(() => {
      drawingMgrRef.current?.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
    }, 0);
  }, [resetDraft, clearPreview]);

  const editArea = useCallback(
    (area: ServiceAreaRow) => {
      resetDraft();
      clearPreview();
      setActiveAreaId(area.id);
      setDraftName(area.name);

      const gj = maybeParseGeo(area.gj);
      if (!gj || gj.type !== "MultiPolygon") return;

      const newPolys: google.maps.Polygon[] = [];
      (gj.coordinates as any[]).forEach((poly: any) => {
        const paths = (poly as any[]).map((ring: any[]) =>
          ring
            .map((pair: any) => pairToLatLng(pair))
            .filter(Boolean) as { lat: number; lng: number }[]
        );

        const gpoly = new google.maps.Polygon({
          paths,
          ...polyStyle,
          editable: true,
        });

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
      (a) => normalizeMultiPolygon(maybeParseGeo(a.gj)) === newKey && a.id !== activeAreaId
    );
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
        const { error } = await supabase.rpc("update_service_area", {
          p_area_id: activeAreaId,
          p_gj: multi,
          p_name: draftName || "Untitled Area",
          p_category_id: categoryId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("insert_service_area", {
          p_cleaner_id: myBusinessId,
          p_gj: multi,
          p_name: draftName || "Untitled Area",
          p_category_id: categoryId,
        });
        if (error) throw error;
      }

      await fetchAreas();
      resetDraft();
      setCreating(false);
    } catch (e: any) {
      setError(e.message || "Failed to save area");
    } finally {
      setLoading(false);
    }
  }, [
    activeAreaId,
    myBusinessId,
    draftName,
    draftPolys,
    fetchAreas,
    resetDraft,
    serviceAreas,
    categoryId,
  ]);

  const deleteArea = useCallback(
    (area: ServiceAreaRow) => {
      const slot = sponsorship[area.id]?.slot ?? null;

      const isMineSponsored =
        !!slot &&
        slot.taken &&
        isBlockingStatus(slot.status) &&
        String(slot.owner_business_id || "") === String(myBusinessId);

      setDeleteAreaId(area.id);
      setDeleteAreaName(area.name || "");
      setDeleteIsSponsoredByMe(isMineSponsored);
      setDeleteOpen(true);
    },
    [sponsorship, myBusinessId]
  );

  const cancelDraft = useCallback(() => {
    resetDraft();
    setCreating(false);
  }, [resetDraft]);

  useEffect(() => {
    if (!isLoaded || !mapRef.current || !serviceAreas.length) return;
    zoomToArea(serviceAreas[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, serviceAreas]);

  const totalDraftArea = useMemo(
    () => (isLoaded ? totalAreaMeters(draftPolys) : 0),
    [isLoaded, draftPolys]
  );

  function getAreaSlotState(areaId: string): SingleSlotState | undefined {
    return sponsorship[areaId]?.slot;
  }

  function isAreaLocked(area: ServiceAreaRow): boolean {
    if (typeof area.is_sponsored_locked === "boolean") return area.is_sponsored_locked;

    const s = getAreaSlotState(area.id);
    return !!s && isBlockingStatus(s.status) && s.owner_business_id === myBusinessId;
  }

  function lockedUntilLabel(area: ServiceAreaRow): string | null {
    if (!area.sponsored_until) return null;
    try {
      return new Date(area.sponsored_until).toLocaleDateString();
    } catch {
      return null;
    }
  }

  const sortedServiceAreas = useMemo(() => {
    if (!isLoaded) return serviceAreas;

    const isSponsored = (id: string) => {
      const slot = sponsorship[id]?.slot ?? null;
      return !!slot && slot.taken && isBlockingStatus(slot.status);
    };

    return [...serviceAreas].sort((a, b) => {
      const aS = isSponsored(a.id);
      const bS = isSponsored(b.id);
      if (aS !== bS) return aS ? -1 : 1;
      return areaKm2(b) - areaKm2(a);
    });
  }, [isLoaded, serviceAreas, sponsorship, areaKm2]);

  // ...rest of file unchanged EXCEPT: display km² uses areaKm2(a)

  if (loadError) {
    return <div className="card card-pad text-red-600">Failed to load Google Maps.</div>;
  }

  return (
    <>
      {/* ... */}
      {/* In your list item display, replace km² line with: */}
      {/* {areaKm2(a).toFixed(2)} km² */}
    </>
  );
}
