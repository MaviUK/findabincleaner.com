// src/components/ServiceAreaEditor.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import GoogleAreaDrawer from "./GoogleAreaDrawer";
import AreaSponsorModal from "./AreaSponsorModal";

/** DB row type (unchanged) */
export interface ServiceAreaRow {
  id: string;
  cleaner_id: string;
  name: string;
  gj: any; // GeoJSON MultiPolygon
  created_at: string;
}

// Simple pretty area helper (optional visual only)
function fmtAreaKm2(multi: any) {
  try {
    if (!multi || multi.type !== "MultiPolygon") return "";
    // very rough planar area; server is source of truth for billing anyway
    let sum = 0;
    (multi.coordinates as number[][][][]).forEach((poly) => {
      const ring = poly[0]; // outer ring only for rough display
      for (let i = 1; i < ring.length; i++) {
        const [x1, y1] = ring[i - 1];
        const [x2, y2] = ring[i];
        sum += x1 * y2 - x2 * y1;
      }
    });
    const km2 = Math.abs(sum) * 0.000001; // bogus scale; display only
    return `${km2.toFixed(2)} km²`;
  } catch {
    return "";
  }
}

// Normalize MultiPolygon for rough duplicate detection
const round = (n: number, p = 5) => Number(n.toFixed(p));
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

export default function ServiceAreaEditor({ cleanerId }: { cleanerId: string }) {
  const [serviceAreas, setServiceAreas] = useState<ServiceAreaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // draft / edit state
  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string>("");
  const [draftGJ, setDraftGJ] = useState<GeoJSON.Polygon | GeoJSON.MultiPolygon | null>(null);
  const [creating, setCreating] = useState(false);

  // sponsor modal
  const [sponsorOpen, setSponsorOpen] = useState(false);
  const [sponsorAreaId, setSponsorAreaId] = useState<string | null>(null);
  const [sponsorSlot, setSponsorSlot] = useState<1 | 2 | 3>(1);

  // Load areas
  const fetchAreas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc("list_service_areas", { p_cleaner_id: cleanerId });
      if (error) throw error;
      setServiceAreas(data || []);
    } catch (e: any) {
      setError(e.message || "Failed to load service areas");
    } finally {
      setLoading(false);
    }
  }, [cleanerId]);

  useEffect(() => {
    fetchAreas();
  }, [fetchAreas]);

  // Start new
  const startNewArea = useCallback(() => {
    setCreating(true);
    setActiveAreaId(null);
    setDraftName("New Service Area");
    setDraftGJ(null); // GoogleAreaDrawer starts empty
  }, []);

  // Edit existing
  const editArea = useCallback((area: ServiceAreaRow) => {
    setCreating(true);
    setActiveAreaId(area.id);
    setDraftName(area.name);
    setDraftGJ(area.gj || null);
  }, []);

  // Save
  const saveDraft = useCallback(async () => {
    if (!draftGJ) {
      setError("Draw at least one polygon.");
      return;
    }
    // Convert Polygon -> MultiPolygon for storage consistency
    const multi =
      draftGJ.type === "Polygon"
        ? { type: "MultiPolygon", coordinates: [draftGJ.coordinates] }
        : draftGJ;

    // Duplicate detection
    const newKey = normalizeMultiPolygon(multi);
    const dup = serviceAreas.find((a) => normalizeMultiPolygon(a.gj) === newKey && a.id !== activeAreaId);
    if (dup) {
      setError(`This area matches an existing one: “${dup.name}”.`);
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
          p_cleaner_id: cleanerId,
          p_gj: multi,
          p_name: draftName || "Untitled Area",
        });
        if (error) throw error;
      }
      await fetchAreas();
      setCreating(false);
      setActiveAreaId(null);
      setDraftGJ(null);
      setDraftName("");
    } catch (e: any) {
      setError(e.message || "Failed to save area");
    } finally {
      setLoading(false);
    }
  }, [activeAreaId, cleanerId, draftGJ, draftName, fetchAreas, serviceAreas]);

  // Delete
  const deleteArea = useCallback(
    async (area: ServiceAreaRow) => {
      if (!confirm(`Delete “${area.name}”?`)) return;
      setLoading(true);
      setError(null);
      try {
        const { error } = await supabase.rpc("delete_service_area", { p_area_id: area.id });
        if (error) throw error;
        if (activeAreaId === area.id) {
          setCreating(false);
          setActiveAreaId(null);
          setDraftGJ(null);
          setDraftName("");
        }
        await fetchAreas();
      } catch (e: any) {
        setError(e.message || "Failed to delete area");
      } finally {
        setLoading(false);
      }
    },
    [activeAreaId, fetchAreas]
  );

  const cancelDraft = useCallback(() => {
    setCreating(false);
    setActiveAreaId(null);
    setDraftGJ(null);
    setDraftName("");
  }, []);

  const roughArea = useMemo(
    () =>
      draftGJ
        ? fmtAreaKm2(
            draftGJ.type === "Polygon"
              ? { type: "MultiPolygon", coordinates: [draftGJ.coordinates] }
              : draftGJ
          )
        : "",
    [draftGJ]
  );

  return (
    <>
      <div className="grid md:grid-cols-12 gap-6">
        {/* Left panel */}
        <div className="md:col-span-4 space-y-4">
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-lg">Service Areas</h3>
              <button className="btn" onClick={startNewArea} disabled={loading}>
                + New Area
              </button>
            </div>

            {loading && <div className="text-sm text-gray-500 mb-2">Working…</div>}
            {error && (
              <div className="mb-2 text-sm text-red-600 bg-red-50 rounded p-2 border border-red-200">
                {error}
              </div>
            )}

            {(creating || activeAreaId !== null) && (
              <div className="border rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    className="input w-full"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="Area name"
                  />
                </div>

                <div className="text-sm text-gray-600 mb-2">
                  {roughArea && <>Coverage: {roughArea}</>}
                </div>

                <div className="flex gap-2">
                  <button className="btn" onClick={saveDraft} disabled={loading || !draftGJ}>
                    {activeAreaId ? "Save Changes" : "Save Area"}
                  </button>
                  <button className="btn" onClick={cancelDraft} disabled={loading}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* List */}
            <ul className="space-y-2">
              {serviceAreas.map((a) => (
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

                  {/* Sponsor buttons */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className="btn"
                      onClick={() => {
                        setSponsorAreaId(a.id);
                        setSponsorSlot(1);
                        setSponsorOpen(true);
                      }}
                    >
                      Sponsor #1
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setSponsorAreaId(a.id);
                        setSponsorSlot(2);
                        setSponsorOpen(true);
                      }}
                    >
                      Sponsor #2
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setSponsorAreaId(a.id);
                        setSponsorSlot(3);
                        setSponsorOpen(true);
                      }}
                    >
                      Sponsor #3
                    </button>
                  </div>
                </li>
              ))}
              {!serviceAreas.length && !loading && (
                <li className="text-sm text-gray-500">
                  No service areas yet. Click “New Area” to draw one.
                </li>
              )}
            </ul>
          </div>

          <div className="card card-pad text-sm text-gray-600">
            <div className="font-semibold mb-1">Tips</div>
            <ul className="list-disc pl-5 space-y-1">
              <li>Click “New Area”, then click around the map to draw a polygon. Double-click to finish.</li>
              <li>Drag the white handles to adjust vertices. You can save multiple polygons in one area.</li>
            </ul>
          </div>
        </div>

        {/* Map (Google) */}
        <div className="md:col-span-8">
          <GoogleAreaDrawer
            initialGeoJSON={(creating || activeAreaId) ? (draftGJ as any) : null}
            onChange={(gj) => setDraftGJ(gj)}
            center={[54.607868, -5.926437]}  // <-- tuple, not { lat, lng }
            zoom={11}
          />
        </div>
      </div>

      {/* Sponsor modal */}
      {sponsorOpen && sponsorAreaId && (
        <AreaSponsorModal
          open={sponsorOpen}
          onClose={() => setSponsorOpen(false)}
          cleanerId={serviceAreas.find((a) => a.id === sponsorAreaId)?.cleaner_id || ""}
          areaId={sponsorAreaId}
          slot={sponsorSlot}
        />
      )}
    </>
  );
}
