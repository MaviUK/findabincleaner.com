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
  business_id: string;
  name: string;
  gj: any; // GeoJSON MultiPolygon
  created_at: string;
}

type Slot = 1 | 2 | 3;

type SlotState = {
  slot: Slot;
  taken: boolean;
  status: string | null;
  owner_business_id: string | null;
};

type SponsorshipState = {
  area_id: string;
  slots: SlotState[]; // normalized to array
  paint?: { tier: 0 | 1 | 2 | 3; fill: string; stroke: string };
};
type SponsorshipMap = Record<string, SponsorshipState | undefined>;

type Libraries = ("drawing" | "geometry")[];

// statuses that should *block* a slot
const isBlockingStatus = (s?: string | null) =>
  ["active", "trialing", "past_due", "unpaid", "incomplete"].includes((s || "").toLowerCase());

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
  businessId?: string;
  cleanerId?: string;
  sponsorshipVersion?: number;
  onSlotAction?: (area: { id: string; name?: string }, slot: Slot) => void | Promise<void>;
};

export default function ServiceAreaEditor({
  businessId,
  cleanerId,
  sponsorshipVersion = 0,
  onSlotAction,
}: Props) {
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
  const [sponsorSlot, setSponsorSlot] = useState<Slot>(1);

  // manage modal state
  const [manageOpen, setManageOpen] = useState(false);
  const [manageAreaId, setManageAreaId] = useState<string | null>(null);
  const [manageSlot, setManageSlot] = useState<Slot>(1);

  // ---- PREVIEW OVERLAY ----
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

  // Fetch areas (RPC still uses p_cleaner_id)
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

  // ------- Fetch sponsorships and normalize to array -------
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

        const slotsArray: SlotState[] = Array.isArray(rawSlots)
          ? rawSlots
          : Object.values(rawSlots || {}).map((s: any) => ({
              slot: s.slot as Slot,
              taken: Boolean(s.taken),
              status: s.status ?? null,
              owner_business_id:
                s.owner_business_id ?? s.by_business_id ?? s.business_id ?? null,
            }));

        map[a.area_id] = {
          area_id: a.area_id,
          slots: slotsArray,
          paint: a.paint,
        };
      }

      // Helpful in dev to inspect what the server returned
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug("[ServiceAreaEditor] sponsorship map:", map);
      }

      setSponsorship(map);
    } catch (e) {
      console.warn("[ServiceAreaEditor] area-sponsorship fetch failed:", e);
      setSponsorship({});
    }
  }, []);

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
    clearPreview();
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
      clearPreview();
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
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("insert_service_area", {
          p_cleaner_id: myBusinessId,
          p_gj: multi,
          p_name: draftName || "Untitled Area",
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
  }, [activeAreaId, myBusinessId, draftName, draftPolys, fetchAreas, resetDraft, serviceAreas]);

  const deleteArea = useCallback(
    async (area: ServiceAreaRow) => {
      if (!confirm(`Delete “${area.name}”?`)) return;
      setLoading(true);
      setError(null);
      try {
        const { error } = await supabase.rpc("delete_service_area", { p_area_id: area.id });
        if (error) throw error;
        if (activeAreaId === area.id) resetDraft();
        setServiceAreas((prev) => prev.filter((a) => a.id !== area.id));
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

  useEffect(() => {
    if (!isLoaded || !mapRef.current || !serviceAreas.length) return;
    const first = serviceAreas[0];
    const gj = first.gj;
    if (!gj || gj.type !== "MultiPolygon") return;
    const bounds = new google.maps.LatLngBounds();
    (gj.coordinates as number[][][][]).forEach((poly) => {
      const rings = poly;
      rings.forEach((ring) =>
        ring.forEach(([lng, lat]) => bounds.extend(new google.maps.LatLng(lat, lng)))
      );
    });
    if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds);
  }, [isLoaded, serviceAreas]);

  const totalDraftArea = useMemo(
    () => (isLoaded ? totalAreaMeters(draftPolys) : 0),
    [isLoaded, draftPolys]
  );

  function slotInfo(areaId: string, slot: Slot): SlotState | undefined {
    const s = sponsorship[areaId];
    if (!s) return undefined;
    return (s.slots as SlotState[]).find((x) => x.slot === slot);
  }
  function areaPaint(areaId: string) {
    return sponsorship[areaId]?.paint;
  }

  if (loadError)
    return <div className="card card-pad text-red-600">Failed to load Google Maps.</div>;

  return (
    <>
      <div className="grid md:grid-cols-12 gap-6">
        {/* Left panel */}
        <div className="md:col-span-4 space-y-4">
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-lg">Service Areas</h3>
              <button className="btn" onClick={startNewArea} disabled={!isLoaded || loading}>
                + New Area
              </button>
            </div>

            {loading && <div className="text-sm text-gray-500 mb-2">Working…</div>}
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
                    Drawing mode is ON — click on the map to add vertices, double-click to finish the polygon.
                  </div>
                )}

                <div className="text-sm text-gray-600 mb-2">
                  Polygons: {draftPolys.length} • Coverage: {fmtArea(totalDraftArea)}
                </div>

                <div className="flex gap-2">
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
              {serviceAreas.map((a) => {
                const s1 = slotInfo(a.id, 1);
                const s2 = slotInfo(a.id, 2);
                const s3 = slotInfo(a.id, 3);

                // “mine” only when status is blocking AND I'm the owner
                const mine1 = !!s1 && isBlockingStatus(s1.status) && s1.owner_business_id === myBusinessId;
                const mine2 = !!s2 && isBlockingStatus(s2.status) && s2.owner_business_id === myBusinessId;
                const mine3 = !!s3 && isBlockingStatus(s3.status) && s3.owner_business_id === myBusinessId;

                const ownsAny = mine1 || mine2 || mine3;

                // taken by someone else: status blocks AND owned by a *different* business
                const taken1ByOther = !!s1 && isBlockingStatus(s1.status) && s1.owner_business_id !== myBusinessId;
                const taken2ByOther = !!s2 && isBlockingStatus(s2.status) && s2.owner_business_id !== myBusinessId;
                const taken3ByOther = !!s3 && isBlockingStatus(s3.status) && s3.owner_business_id !== myBusinessId;

                // disable when taken by others OR I already own a different slot here
                const dis1 = taken1ByOther || (!mine1 && ownsAny);
                const dis2 = taken2ByOther || (!mine2 && ownsAny);
                const dis3 = taken3ByOther || (!mine3 && ownsAny);

                const clickSlot = async (slot: Slot, isMine: boolean, isDisabled: boolean) => {
                  if (isDisabled) return;
                  if (isMine) {
                    if (onSlotAction) {
                      await onSlotAction({ id: a.id, name: a.name }, slot);
                    } else {
                      setManageAreaId(a.id);
                      setManageSlot(slot);
                      setManageOpen(true);
                    }
                    return;
                  }
                  setSponsorAreaId(a.id);
                  setSponsorSlot(slot);
                  setSponsorOpen(true);
                };

                const titleFor = (mine: boolean, slotState?: SlotState) =>
                  mine
                    ? "You sponsor this slot"
                    : ownsAny
                    ? "You already sponsor a slot in this area"
                    : slotState && isBlockingStatus(slotState.status)
                    ? `Status: ${slotState.status || "taken"}`
                    : "Available";

                const label = (mine: boolean, takenByOther: boolean, n: Slot) =>
                  mine ? `Manage #${n}` : takenByOther ? `Taken #${n}` : `Sponsor #${n}`;

                return (
                  <li key={a.id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{a.name}</div>
                        <div className="text-xs text-gray-500">
                          {new Date(a.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn" onClick={() => editArea(a)} disabled={loading}>
                          Edit
                        </button>
                        <button className="btn" onClick={() => deleteArea(a)} disabled={loading}>
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 items-center">
                      <button
                        className={`btn ${dis1 ? "opacity-50 cursor-not-allowed" : ""}`}
                        onClick={() => clickSlot(1, mine1, dis1)}
                        disabled={dis1}
                        title={titleFor(mine1, s1)}
                      >
                        {label(mine1, taken1ByOther, 1)}
                      </button>
                      {import.meta.env.DEV && s1?.status && (
                        <span className="text-[10px] px-1 py-[2px] rounded bg-gray-100 text-gray-600">
                          {s1.status}{s1.owner_business_id ? `:${s1.owner_business_id.slice(0,8)}` : ""}
                        </span>
                      )}

                      <button
                        className={`btn ${dis2 ? "opacity-50 cursor-not-allowed" : ""}`}
                        onClick={() => clickSlot(2, mine2, dis2)}
                        disabled={dis2}
                        title={titleFor(mine2, s2)}
                      >
                        {label(mine2, taken2ByOther, 2)}
                      </button>
                      {import.meta.env.DEV && s2?.status && (
                        <span className="text-[10px] px-1 py-[2px] rounded bg-gray-100 text-gray-600">
                          {s2.status}{s2.owner_business_id ? `:${s2.owner_business_id.slice(0,8)}` : ""}
                        </span>
                      )}

                      <button
                        className={`btn ${dis3 ? "opacity-50 cursor-not-allowed" : ""}`}
                        onClick={() => clickSlot(3, mine3, dis3)}
                        disabled={dis3}
                        title={titleFor(mine3, s3)}
                      >
                        {label(mine3, taken3ByOther, 3)}
                      </button>
                      {import.meta.env.DEV && s3?.status && (
                        <span className="text-[10px] px-1 py-[2px] rounded bg-gray-100 text-gray-600">
                          {s3.status}{s3.owner_business_id ? `:${s3.owner_business_id.slice(0,8)}` : ""}
                        </span>
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
                  style={{ background: "rgba(255,215,0,0.35)", border: "2px solid #B8860B" }}
                />
                Gold (Slot #1)
              </span>
              <span className="inline-flex items-center gap-1">
                <i
                  className="inline-block w-4 h-4 rounded"
                  style={{ background: "rgba(192,192,192,0.35)", border: "2px solid #708090" }}
                />
                Silver (Slot #2)
              </span>
              <span className="inline-flex items-center gap-1">
                <i
                  className="inline-block w-4 h-4 rounded"
                  style={{ background: "rgba(205,127,50,0.35)", border: "2px solid #8B5A2B" }}
                />
                Bronze (Slot #3)
              </span>
            </div>
            <div className="font-semibold mb-1">Tips</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Click “New Area”, then click around the map to draw a polygon. Double-click to finish.</li>
              <li>Drag the white handles to adjust vertices. Use “Clear Polygons” to redraw before saving.</li>
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
                  drawingControlOptions: { drawingModes: [google.maps.drawing.OverlayType.POLYGON] },
                  polygonOptions: polyStyle,
                }}
              />

              {/* Painted overlays */}
              {activeAreaId === null &&
                serviceAreas.map((a) => {
                  const gj = a.gj;
                  if (!gj || gj.type !== "MultiPolygon") return null;

                  const previewIsForThisArea = previewActiveForArea && sponsorAreaId === a.id;
                  if (previewIsForThisArea) return null;

                  const paint = areaPaint(a.id);
                  const style: google.maps.PolygonOptions = {
                    ...polyStyle,
                    editable: false,
                    draggable: false,
                    fillOpacity: 0.35,
                    strokeOpacity: 0.9,
                    fillColor: paint?.fill ?? "rgba(0,0,0,0.0)",
                    strokeColor: paint?.stroke ?? "#555",
                  };

                  return (gj.coordinates as number[][][][]).map((poly, i) => {
                    const rings = poly;
                    const paths = rings.map((ring) => ring.map(([lng, lat]) => ({ lat, lng })));
                    return <Polygon key={`${a.id}-${i}`} paths={paths} options={style} />;
                  });
                })}

              {/* Preview overlay */}
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
          areaId={sponsorAreaId}
          slot={sponsorSlot}
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
          slot={manageSlot}
        />
      )}
    </>
  );
}
