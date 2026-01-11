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

/** ServiceAreaEditor – draw/edit areas and show sponsor/manage CTAs (single Featured slot) */

export interface ServiceAreaRow {
  id: string;
  cleaner_id: string;
  category_id: string | null;
  name: string;
  gj: any; // GeoJSON MultiPolygon
  created_at: string;

  // ✅ NEW: lock info (from RPC)
  is_sponsored_locked?: boolean;
  sponsored_until?: string | null;
}

// Keep Slot type for back-compat where needed
type Slot = 1;

type SingleSlotState = {
  taken: boolean;
  status: string | null;
  owner_business_id: string | null;

  // ✅ NEW: actual sponsored geometry (ONLY the purchased portion)
  // Expected to be GeoJSON (Polygon/MultiPolygon/Feature/FeatureCollection).
  sponsored_geojson?: any | null;
};

type SponsorshipState = {
  area_id: string;
  slot: SingleSlotState; // single Featured slot
  sponsored_geojson?: any | null; // ✅ NEW
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

/** Accept Polygon/MultiPolygon/Feature/FeatureCollection and return array of rings-paths for <Polygon /> */
function geoToPaths(geo: any): { paths: { lat: number; lng: number }[][] }[] {
  if (!geo) return [];

  if (geo.type === "FeatureCollection" && Array.isArray(geo.features)) {
    return geo.features.flatMap((f: any) => geoToPaths(f));
  }

  if (geo.type === "Feature" && geo.geometry) {
    return geoToPaths(geo.geometry);
  }

  if (geo.type === "MultiPolygon" && Array.isArray(geo.coordinates)) {
    return (geo.coordinates as number[][][][]).map((poly) => ({
      paths: poly.map((ring) =>
        ring.map((pair) => {
          const [a, b] = pair;
          const lng =
            typeof a === "number" && typeof b === "number"
              ? a
              : (pair as any)[0];
          const lat =
            typeof a === "number" && typeof b === "number"
              ? b
              : (pair as any)[1];
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
            const lng =
              typeof a === "number" && typeof b === "number"
                ? a
                : (pair as any)[0];
            const lat =
              typeof a === "number" && typeof b === "number"
                ? b
                : (pair as any)[1];
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

/** area size helper for sorting (km²) */
function geoMultiPolygonAreaKm2(gj: any): number {
  if (!gj || gj.type !== "MultiPolygon" || !Array.isArray(gj.coordinates))
    return 0;

  let totalM2 = 0;
  for (const poly of gj.coordinates as number[][][][]) {
    for (let ringIndex = 0; ringIndex < poly.length; ringIndex++) {
      const ring = poly[ringIndex];
      const path = ring.map(([lng, lat]) => new google.maps.LatLng(lat, lng));
      const ringM2 = google.maps.geometry.spherical.computeArea(path);
      totalM2 += ringIndex === 0 ? Math.abs(ringM2) : -Math.abs(ringM2);
    }
  }
  return Math.max(0, totalM2) / 1_000_000;
}

type Props = {
  businessId?: string;
  cleanerId?: string;
  categoryId?: string | null;
  sponsorshipVersion?: number;
  onSlotAction?: (
    area: { id: string; name?: string },
    slot: Slot
  ) => void | Promise<void>;
};

type AvailMap = Record<string, boolean | undefined>;
type AvailLoadingMap = Record<string, boolean>;

// ✅ categories for "Copy to Industry"
type CategoryRow = { id: string; name: string; slug: string | null };

export default function ServiceAreaEditor({
  businessId,
  cleanerId,
  categoryId = null,
  sponsorshipVersion = 0,
  onSlotAction,
}: Props) {
  const myBusinessId = (businessId ?? cleanerId) || "";

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

  // availability from server
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

  // ---- PREVIEW OVERLAY ----
  const [previewGeo, setPreviewGeo] = useState<any | null>(null);
  const clearPreview = useCallback(() => setPreviewGeo(null), []);
  const drawPreview = useCallback(
    (multi: any) => setPreviewGeo(multi ?? null),
    []
  );
  const previewPolys = useMemo(() => geoToPaths(previewGeo), [previewGeo]);

  // ✅ Copy-to-industry state
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyArea, setCopyArea] = useState<ServiceAreaRow | null>(null);
  const [copyTargetCategoryId, setCopyTargetCategoryId] = useState<string>("");
  const [copyName, setCopyName] = useState<string>("");
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyErr, setCopyErr] = useState<string | null>(null);

  // ✅ Fetch ONLY active industries for this cleaner
  useEffect(() => {
    if (!myBusinessId) return;

    (async () => {
      const { data, error } = await supabase.rpc(
        "list_active_categories_for_cleaner",
        { p_cleaner_id: myBusinessId }
      );

      if (error) {
        console.warn("active categories fetch error:", error);
        setCategories([]);
        return;
      }

      setCategories((data as any) || []);
    })();
  }, [myBusinessId]);

  // ✅ When switching industry tabs, clear cached per-area state so UI doesn't bleed across tabs
  useEffect(() => {
    setSponsorship({});
    setAvail({});
    setAvailLoading({});
    setPreviewGeo(null);
    setSponsorOpen(false);
    setSponsorAreaId(null);
    setManageOpen(false);
    setManageAreaId(null);

    // also close copy modal
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

  // Fetch areas (per industry)
  const fetchAreas = useCallback(async () => {
    if (!myBusinessId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc("list_service_areas", {
        p_cleaner_id: myBusinessId,
        p_category_id: categoryId, // ✅ per-industry areas
      });
      if (error) throw error;
      setServiceAreas(data || []);
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

  // ------- Sponsorship occupancy (single-slot) -------

  const OWNED_BY_ME_PAINT = {
    tier: 3,
    fill: "rgba(34, 197, 94, 0.45)",
    stroke: "#16a34a",
  } as const;

  const OWNED_BY_OTHER_PAINT = {
    tier: 2,
    fill: "rgba(239, 68, 68, 0.30)",
    stroke: "#dc2626",
  } as const;

  function isOwnedSlot(slot: SingleSlotState | null) {
    return !!slot && slot.taken && isBlockingStatus(slot.status);
  }

  function ownedPaintFor(slot: SingleSlotState | null, bizId: string) {
    if (!isOwnedSlot(slot)) return undefined;
    const isMine = slot?.owner_business_id === bizId;
    return isMine ? OWNED_BY_ME_PAINT : OWNED_BY_OTHER_PAINT;
  }

  const fetchSponsorship = useCallback(
    async (areaIds: string[]) => {
      if (!areaIds.length || !myBusinessId) return;

      try {
        const res = await fetch("/.netlify/functions/area-sponsorship", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            areaIds,
            categoryId, // ✅ isolate by industry
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
                  s1.owner_business_id ??
                  s1.by_business_id ??
                  s1.business_id ??
                  null,
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
          const sponsored_geojson = slot?.sponsored_geojson ?? null;

          map[a.area_id] = {
            area_id: a.area_id,
            slot,
            sponsored_geojson,
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

  // ------- Availability by geometry -------
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
        const hasRemaining =
          !soldOut && Number.isFinite(km2) ? km2 > 0 : false;

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

  const zoomToArea = useCallback(
    (area: ServiceAreaRow) => {
      if (!isLoaded || !mapRef.current) return;

      const gj = area?.gj;
      if (!gj?.coordinates) return;

      const bounds = new google.maps.LatLngBounds();

      // Supports MultiPolygon and Polygon (just in case)
      const polys: number[][][][] =
        gj.type === "Polygon"
          ? [gj.coordinates as unknown as number[][][]]
          : (gj.coordinates as unknown as number[][][][]);

      polys.forEach((rings) => {
        (rings as unknown as number[][][]).forEach((ring) => {
          ring.forEach(([lng, lat]) =>
            bounds.extend(new google.maps.LatLng(lat, lng))
          );
        });
      });

      if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds, 60);
      }
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
      drawingMgrRef.current?.setDrawingMode(
        google.maps.drawing.OverlayType.POLYGON
      );
    }, 0);
  }, [resetDraft, clearPreview]);

  const editArea = useCallback(
    (area: ServiceAreaRow) => {
      resetDraft();
      clearPreview();
      setActiveAreaId(area.id);
      setDraftName(area.name);

      const gj = area.gj;
      if (!gj || gj.type !== "MultiPolygon") return;

      const newPolys: google.maps.Polygon[] = [];
      (gj.coordinates as number[][][][]).forEach((poly) => {
        const paths = poly.map((ring) =>
          ring.map(([lng, lat]) => ({ lat, lng }))
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
      (a) => normalizeMultiPolygon(a.gj) === newKey && a.id !== activeAreaId
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
    async (area: ServiceAreaRow) => {
      if (!confirm(`Delete “${area.name}”?`)) return;
      setLoading(true);
      setError(null);
      try {
        const { error } = await supabase.rpc("delete_service_area", {
          p_area_id: area.id,
        });
        if (error) throw error;

        if (activeAreaId === area.id) resetDraft();
        setServiceAreas((prev) => prev.filter((x) => x.id !== area.id));
        await fetchAreas();
      } catch (e: any) {
        setError(e.message || "Failed to delete area");
      } finally {
        setLoading(false);
      }
    },
    [activeAreaId, fetchAreas, resetDraft]
  );

  const cancelDraft = useCallback(() => {
    resetDraft();
    setCreating(false);
  }, [resetDraft]);

  // Fit bounds to first area when loaded
  useEffect(() => {
    if (!isLoaded || !mapRef.current || !serviceAreas.length) return;
    const first = serviceAreas[0];
    const gj = first.gj;
    if (!gj || gj.type !== "MultiPolygon") return;

    const bounds = new google.maps.LatLngBounds();
    (gj.coordinates as number[][][][]).forEach((poly) => {
      poly.forEach((ring) =>
        ring.forEach(([lng, lat]) =>
          bounds.extend(new google.maps.LatLng(lat, lng))
        )
      );
    });
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds);
  }, [isLoaded, serviceAreas]);

  const totalDraftArea = useMemo(
    () => (isLoaded ? totalAreaMeters(draftPolys) : 0),
    [isLoaded, draftPolys]
  );

  function getAreaSlotState(areaId: string): SingleSlotState | undefined {
    return sponsorship[areaId]?.slot;
  }

  function isAreaLocked(area: ServiceAreaRow): boolean {
    if (typeof area.is_sponsored_locked === "boolean")
      return area.is_sponsored_locked;

    const s = getAreaSlotState(area.id);
    const mine =
      !!s && isBlockingStatus(s.status) && s.owner_business_id === myBusinessId;

    return mine;
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

    const sizeKm2 = (a: ServiceAreaRow) => geoMultiPolygonAreaKm2(a.gj);

    return [...serviceAreas].sort((a, b) => {
      const aS = isSponsored(a.id);
      const bS = isSponsored(b.id);
      if (aS !== bS) return aS ? -1 : 1;
      return sizeKm2(b) - sizeKm2(a);
    });
  }, [isLoaded, serviceAreas, sponsorship]);

  // ✅ COPY ACTION
  const openCopyModal = useCallback(
    (area: ServiceAreaRow) => {
      setCopyErr(null);

      if (!categories.length) {
        setCopyErr(
          "Industries couldn't load. Fix Supabase RLS on the categories table."
        );
        setCopyOpen(true);
        setCopyArea(area);
        setCopyTargetCategoryId("");
        setCopyName(area.name ? `${area.name} (copy)` : "");
        return;
      }

      setCopyArea(area);
      setCopyOpen(true);

      const firstOther = categories.find((c) => c.id !== (categoryId ?? ""));
      setCopyTargetCategoryId(firstOther?.id || "");
      setCopyName(area.name ? `${area.name} (copy)` : "");
    },
    [categories, categoryId]
  );

  const doCopyToIndustry = useCallback(async () => {
    if (!copyArea || !copyTargetCategoryId || !myBusinessId) return;

    setCopyBusy(true);
    setCopyErr(null);

    try {
      const { error } = await supabase.rpc("clone_service_area_to_category", {
        p_area_id: copyArea.id,
        p_cleaner_id: myBusinessId,
        p_target_category_id: copyTargetCategoryId,
        p_new_name: copyName?.trim() || null,
      });
      if (error) throw error;

      setCopyOpen(false);
      setCopyArea(null);
      setCopyTargetCategoryId("");
      setCopyName("");
      await fetchAreas();
    } catch (e: any) {
      const msg = String(e?.message || "");

      if (msg.includes("uix_service_areas_cleaner_category_name")) {
        setCopyErr(
          "This area already exists in the selected industry. Try using a different name."
        );
      } else {
        setCopyErr("Failed to copy area. Please try again.");
      }
    } finally {
      setCopyBusy(false);
    }
  }, [copyArea, copyTargetCategoryId, myBusinessId, copyName, fetchAreas]);

  if (loadError) {
    return (
      <div className="card card-pad text-red-600">
        Failed to load Google Maps.
      </div>
    );
  }

  return (
    <>
      <div className="grid md:grid-cols-12 gap-6">
        {/* Left panel */}
        <div className="md:col-span-4 space-y-4">
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-lg">Service Areas</h3>
              <button
                className="btn"
                onClick={startNewArea}
                disabled={!isLoaded || loading}
              >
                + New Area
              </button>
            </div>

            {loading && (
              <div className="text-sm text-gray-500 mb-2">Working…</div>
            )}

            {error && (
              <div className="mb-2 text-sm text-red-600 bg-red-50 rounded p-2 border border-red-200">
                {error}
              </div>
            )}

            {(creating || activeAreaId !== null || draftPolys.length > 0) && (
              <div className="border rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    className="input w-full"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="Area name"
                  />
                </div>

                {creating && draftPolys.length === 0 && (
                  <div className="text-xs text-gray-600 mb-2">
                    Drawing mode is ON — click on the map to add vertices,
                    double-click to finish the polygon.
                  </div>
                )}

                <div className="text-sm text-gray-600 mb-2">
                  Polygons: {draftPolys.length} • Coverage:{" "}
                  {fmtArea(totalDraftArea)}
                </div>

                <div className="flex flex-wrap gap-2">
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
              {sortedServiceAreas.map((a) => {
                const s = getAreaSlotState(a.id);
                const mine =
                  !!s &&
                  isBlockingStatus(s.status) &&
                  s.owner_business_id === myBusinessId;

                const locked = isAreaLocked(a);
                const until = lockedUntilLabel(a);

                const takenByOther =
                  !!s &&
                  isBlockingStatus(s.status) &&
                  s.owner_business_id !== myBusinessId;

                const hasGeo = avail[a.id] ?? true;
                const busy = availLoading[a.id];

                const disabled =
                  takenByOther || (!mine && !takenByOther && hasGeo === false);

                const title = mine
                  ? "You sponsor this area"
                  : takenByOther
                  ? `Taken${s?.status ? ` (${s.status})` : ""}`
                  : hasGeo === false
                  ? "No purchasable region available"
                  : busy
                  ? "Checking availability…"
                  : "Available";

                const label = mine
                  ? "Manage"
                  : takenByOther
                  ? "Taken"
                  : hasGeo === false
                  ? "Sold out"
                  : "Sponsor (Featured)";

                const onClick = async () => {
                  if (disabled) return;

                  if (mine) {
                    if (onSlotAction) {
                      await onSlotAction({ id: a.id, name: a.name }, 1);
                    } else {
                      setManageAreaId(a.id);
                      setManageOpen(true);
                    }
                    return;
                  }

                  setSponsorAreaId(a.id);
                  setSponsorOpen(true);
                };

                return (
                  <li
                    key={a.id}
                    className={`border rounded-lg p-3 transition-colors ${
                      mine
                        ? "border-amber-300 bg-amber-50"
                        : "border-gray-200 bg-white"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => zoomToArea(a)}
                      className="text-left w-full group"
                      title="Click to zoom to this area"
                    >
                      <div className="font-medium truncate group-hover:underline">
                        {a.name}
                      </div>

                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(a.created_at).toLocaleString()} •{" "}
                        {isLoaded ? geoMultiPolygonAreaKm2(a.gj).toFixed(2) : "—"}{" "}
                        km²
                        {locked && until ? (
                          <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800 border border-amber-200">
                            Locked until {until}
                          </span>
                        ) : null}
                      </div>
                    </button>

                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (locked) return;
                          editArea(a);
                        }}
                        disabled={loading || locked}
                        title={locked ? "Sponsored areas are locked" : "Edit"}
                        className={[
                          "btn",
                          locked ? "opacity-40 cursor-not-allowed grayscale" : "",
                        ].join(" ")}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        className="btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteArea(a);
                        }}
                        disabled={loading}
                      >
                        Delete
                      </button>

                      <button
                        type="button"
                        className="btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCopyModal(a);
                        }}
                        disabled={loading}
                        title="Copy this exact area to another industry"
                      >
                        Copy
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 items-center">
                      <button
                        className={`btn ${
                          disabled ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onClick();
                        }}
                        disabled={disabled}
                        title={title}
                      >
                        {label}
                      </button>

                      {busy && (
                        <div className="text-[10px] text-gray-500 mt-1">
                          Checking availability…
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}

              {!serviceAreas.length && !loading && (
                <li className="text-sm text-gray-500">
                  No service areas yet. Click “New Area” to draw one.
                </li>
              )}
            </ul>
          </div>

          <div className="card card-pad text-sm text-gray-600">
            <div className="font-semibold mb-1">Legend</div>
            <div className="flex items-center gap-4 mb-3">
              <span className="inline-flex items-center gap-1">
                <i
                  className="inline-block w-4 h-4 rounded"
                  style={{
                    background: "rgba(34,197,94,0.45)",
                    border: "2px solid #16a34a",
                  }}
                />
                Sponsored by you
              </span>
              <span className="inline-flex items-center gap-1">
                <i
                  className="inline-block w-4 h-4 rounded"
                  style={{
                    background: "rgba(239,68,68,0.35)",
                    border: "2px solid #dc2626",
                  }}
                />
                Sponsored by others
              </span>
              <span className="inline-flex items-center gap-1">
                <i
                  className="inline-block w-4 h-4 rounded"
                  style={{
                    background: "transparent",
                    border: "2px solid #555",
                  }}
                />
                outline
              </span>
            </div>

            <div className="font-semibold mb-1">Tips</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Click “New Area”, then click around the map to draw a polygon.
                Double-click to finish.
              </li>
              <li>
                Drag the white handles to adjust vertices. Use “Clear Polygons”
                to redraw before saving.
              </li>
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
              options={{ mapTypeControl: false, streetViewControl: false }}
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

              {/* ✅ Service area outlines (always visible) */}
              {activeAreaId === null &&
                sortedServiceAreas.map((a) => {
                  const gj = a.gj;
                  if (!gj || gj.type !== "MultiPolygon") return null;

                  return (gj.coordinates as number[][][][]).map((poly, i) => {
                    const paths = poly.map((ring) =>
                      ring.map(([lng, lat]) => ({ lat, lng }))
                    );

                    return (
                      <Polygon
                        key={`outline-${a.id}-${i}`}
                        paths={paths}
                        options={{
                          strokeWeight: 2,
                          strokeOpacity: 0.95,
                          strokeColor: "#555",
                          fillOpacity: 0,
                          clickable: false,
                          editable: false,
                          draggable: false,
                          zIndex: 10,
                        }}
                      />
                    );
                  });
                })}

              {/* ✅ Sponsored fills: ONLY the purchased portion is colored */}
              {activeAreaId === null &&
                sortedServiceAreas.map((a) => {
                  const slot = sponsorship[a.id]?.slot;
                  if (!slot || !slot.taken || !isBlockingStatus(slot.status))
                    return null;

                  const sponsored = slot.sponsored_geojson ?? null;
                  if (!sponsored) return null;

                  const isMine = slot.owner_business_id === myBusinessId;
                  const fill = isMine
                    ? "rgba(34, 197, 94, 0.45)"
                    : "rgba(239, 68, 68, 0.30)";
                  const stroke = isMine ? "#16a34a" : "#dc2626";

                  const sponsoredPaths = geoToPaths(sponsored);

                  return sponsoredPaths.map((p, i) => (
                    <Polygon
                      key={`sponsored-${a.id}-${i}`}
                      paths={p.paths}
                      options={{
                        strokeWeight: 2,
                        strokeOpacity: 1,
                        strokeColor: stroke,
                        fillColor: fill,
                        fillOpacity: 0.35,
                        clickable: false,
                        editable: false,
                        draggable: false,
                        zIndex: 50,
                      }}
                    />
                  ));
                })}

              {/* Preview overlay (available region) */}
              {previewPolys.map((p, i) => (
                <Polygon
                  key={`preview-${i}`}
                  paths={p.paths}
                  options={{
                    strokeWeight: 3,
                    strokeOpacity: 1,
                    strokeColor: "#14b8a6",
                    fillColor: "#14b8a6",
                    fillOpacity: 0.22,
                    clickable: false,
                    editable: false,
                    draggable: false,
                    zIndex: 9999,
                  }}
                />
              ))}
            </GoogleMap>
          ) : (
            <div className="card card-pad">Loading map…</div>
          )}
        </div>
      </div>

      {/* Sponsor modal */}
      {sponsorOpen && sponsorAreaId && (
        <AreaSponsorModal
          open={sponsorOpen}
          onClose={() => {
            setSponsorOpen(false);
            clearPreview();
          }}
          businessId={myBusinessId}
          categoryId={categoryId}
          areaId={sponsorAreaId}
          areaName={serviceAreas.find((x) => x.id === sponsorAreaId)?.name}
          onPreviewGeoJSON={(multi) => drawPreview(multi)}
          onClearPreview={() => clearPreview()}
        />
      )}

      {/* Manage modal */}
      {manageOpen && manageAreaId && (
        <AreaManageModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          cleanerId={myBusinessId}
          areaId={manageAreaId}
          slot={1}
        />
      )}

      {/* ✅ Copy to Industry Modal */}
      {copyOpen && copyArea && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div className="font-semibold">Copy area to another industry</div>
                <div className="text-xs text-gray-500">
                  Copying: <span className="font-medium">{copyArea.name}</span>
                </div>
              </div>
              <button
                className="text-sm opacity-70 hover:opacity-100"
                onClick={() => {
                  setCopyOpen(false);
                  setCopyArea(null);
                  setCopyErr(null);
                }}
                disabled={copyBusy}
              >
                Close
              </button>
            </div>

            <div className="px-4 py-4 space-y-3">
              {copyErr && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
                  {copyErr}
                </div>
              )}

              <div className="space-y-1">
                <div className="text-sm font-medium">Target industry</div>
                <select
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={copyTargetCategoryId}
                  onChange={(e) => setCopyTargetCategoryId(e.target.value)}
                  disabled={copyBusy}
                >
                  <option value="">Select…</option>
                  {categories
                    .filter((c) => c.id !== (categoryId ?? ""))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <div className="text-[11px] text-gray-500">
                  This will create a new service area with the exact same polygon.
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-sm font-medium">New area name (optional)</div>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={copyName}
                  onChange={(e) => setCopyName(e.target.value)}
                  placeholder="e.g. Bangor (Window Cleaning)"
                  disabled={copyBusy}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
              <button
                className="btn"
                onClick={() => {
                  setCopyOpen(false);
                  setCopyArea(null);
                  setCopyErr(null);
                }}
                disabled={copyBusy}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={doCopyToIndustry}
                disabled={copyBusy || !copyTargetCategoryId}
                title={!copyTargetCategoryId ? "Select a target industry" : "Copy"}
              >
                {copyBusy ? "Copying…" : "Copy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * IMPORTANT BACKEND NOTE:
 * This file expects /.netlify/functions/area-sponsorship to return "sponsored_geojson"
 * for each area slot (GeoJSON of the purchased portion). Without it, only outlines will show.
 */
