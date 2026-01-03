// src/components/ServiceAreaEditor.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import ServiceAreaMap from "./ServiceAreaMap";
import AreaSponsorModal from "./AreaSponsorModal";
import { toKm2 } from "../lib/geo";

type Props = {
  cleanerId: string;
  categoryId: string | null;
  sponsorshipVersion?: number;
};

type AreaRow = {
  id: string;
  cleaner_id: string;
  name: string | null;
  created_at: string;
  updated_at: string;
  geom: any | null;
  area_km2: number | null;
  category_id: string | null;
};

type SponsoredRow = {
  id: string;
  business_id: string;
  area_id: string;
  slot: number;
  status: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  created_at: string;
  category_id: string | null;
};

type Tab = "areas" | "sponsor";

const DEFAULT_SLOT = 1;

export default function ServiceAreaEditor({ cleanerId, categoryId, sponsorshipVersion }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("areas");

  // sponsor state
  const [sponsored, setSponsored] = useState<SponsoredRow | null>(null);
  const [sponsorModalOpen, setSponsorModalOpen] = useState(false);

  // map/drawing state from child
  const [draftGeoJson, setDraftGeoJson] = useState<any | null>(null);
  const [draftKm2, setDraftKm2] = useState<number | null>(null);

  const selectedArea = useMemo(
    () => areas.find((a) => a.id === selectedAreaId) ?? null,
    [areas, selectedAreaId]
  );

  // ------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------
  const loadAreas = useCallback(async () => {
    if (!categoryId) {
      setAreas([]);
      setSelectedAreaId(null);
      return;
    }

    const { data, error } = await supabase
      .from("service_areas")
      .select("*")
      .eq("cleaner_id", cleanerId)
      .eq("category_id", categoryId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rows = (data || []) as AreaRow[];
    setAreas(rows);

    // keep selection if possible, otherwise pick most recent
    setSelectedAreaId((prev) => {
      if (prev && rows.some((r) => r.id === prev)) return prev;
      return rows[0]?.id ?? null;
    });
  }, [cleanerId, categoryId]);

  const loadSponsorForArea = useCallback(async () => {
    if (!selectedAreaId || !categoryId) {
      setSponsored(null);
      return;
    }

    // There can be multiple rows historically; we want the “current” one
    const { data, error } = await supabase
      .from("sponsored_subscriptions")
      .select("*")
      .eq("business_id", cleanerId)
      .eq("area_id", selectedAreaId)
      .eq("slot", DEFAULT_SLOT)
      .eq("category_id", categoryId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) throw error;

    const row = (data || [])[0] as SponsoredRow | undefined;
    setSponsored(row ?? null);
  }, [selectedAreaId, cleanerId, categoryId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);
        await loadAreas();
        if (!mounted) return;
      } catch (e: any) {
        console.error(e);
        if (!mounted) return;
        setErr(e?.message || "Failed to load service areas.");
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadAreas]);

  useEffect(() => {
    (async () => {
      try {
        setErr(null);
        await loadSponsorForArea();
      } catch (e: any) {
        console.error(e);
        setErr(e?.message || "Failed to load sponsorship status.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSponsorForArea, sponsorshipVersion]);

  // ------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------
  async function createArea() {
    if (!categoryId) return;
    setBusy(true);
    setErr(null);
    try {
      const name = prompt("Area name (e.g., Bangor)") || "";
      if (!name.trim()) return;

      const { data, error } = await supabase
        .from("service_areas")
        .insert({
          cleaner_id: cleanerId,
          name: name.trim(),
          category_id: categoryId,
        })
        .select("*")
        .single();

      if (error) throw error;

      const row = data as AreaRow;
      setAreas((prev) => [row, ...prev]);
      setSelectedAreaId(row.id);
      setTab("areas");
    } catch (e: any) {
      setErr(e?.message || "Failed to create area.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteArea() {
    if (!selectedArea) return;
    if (!confirm(`Delete "${selectedArea.name || "Untitled"}"? This cannot be undone.`)) return;

    setBusy(true);
    setErr(null);
    try {
      const { error } = await supabase.from("service_areas").delete().eq("id", selectedArea.id);
      if (error) throw error;

      setAreas((prev) => prev.filter((a) => a.id !== selectedArea.id));
      setSelectedAreaId((prev) => {
        if (prev !== selectedArea.id) return prev;
        const remaining = areas.filter((a) => a.id !== selectedArea.id);
        return remaining[0]?.id ?? null;
      });

      setSponsored(null);
      setDraftGeoJson(null);
      setDraftKm2(null);
    } catch (e: any) {
      setErr(e?.message || "Failed to delete area.");
    } finally {
      setBusy(false);
    }
  }

  async function copyArea() {
    if (!selectedArea) return;
    setBusy(true);
    setErr(null);
    try {
      const baseName = selectedArea.name || "Area";
      const name = `${baseName} (copy)`;

      const { data, error } = await supabase
        .from("service_areas")
        .insert({
          cleaner_id: cleanerId,
          name,
          category_id: categoryId,
          geom: selectedArea.geom,
          area_km2: selectedArea.area_km2,
        })
        .select("*")
        .single();

      if (error) throw error;

      const row = data as AreaRow;
      setAreas((prev) => [row, ...prev]);
      setSelectedAreaId(row.id);
      setTab("areas");
    } catch (e: any) {
      setErr(e?.message || "Failed to copy area.");
    } finally {
      setBusy(false);
    }
  }

  async function saveGeometry() {
    if (!selectedArea) return;
    if (!draftGeoJson) return;

    setBusy(true);
    setErr(null);
    try {
      const { error } = await supabase
        .from("service_areas")
        .update({
          geom: draftGeoJson,
          area_km2: draftKm2 ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedArea.id);

      if (error) throw error;

      setAreas((prev) =>
        prev.map((a) =>
          a.id === selectedArea.id
            ? {
                ...a,
                geom: draftGeoJson,
                area_km2: draftKm2 ?? null,
                updated_at: new Date().toISOString(),
              }
            : a
        )
      );
    } catch (e: any) {
      setErr(e?.message || "Failed to save polygon.");
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------
  // Rendering helpers
  // ------------------------------------------------------------
  const areaDisplayKm2 =
    (draftKm2 != null ? draftKm2 : selectedArea?.area_km2 != null ? selectedArea.area_km2 : null) ??
    null;

  const areaName = selectedArea?.name || "Untitled";

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------
  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-600">
        Loading service areas…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] min-h-[520px]">
      {/* Left panel */}
      <div className="border-r bg-white">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold">Service Areas</div>
              <div className="text-xs text-gray-500">Create & edit polygons</div>
            </div>
            <button
              className="btn btn-primary"
              onClick={createArea}
              disabled={busy || !categoryId}
              type="button"
            >
              New
            </button>
          </div>
        </div>

        {err && (
          <div className="px-4 py-3 border-b bg-red-50 text-red-700 text-sm">
            {err}
          </div>
        )}

        <div className="p-2">
          {areas.length === 0 ? (
            <div className="p-3 text-sm text-gray-600">
              No areas yet. Click <strong>New</strong>.
            </div>
          ) : (
            <div className="space-y-2">
              {areas.map((a) => {
                const active = a.id === selectedAreaId;
                return (
                  <div
                    key={a.id}
                    className={[
                      "rounded-xl border p-3 cursor-pointer transition",
                      active ? "border-ink-300 bg-ink-50" : "border-ink-100 hover:bg-gray-50",
                    ].join(" ")}
                    onClick={() => {
                      setSelectedAreaId(a.id);
                      setTab("areas");
                    }}
                  >
                    <div className="font-semibold truncate">{a.name || "Untitled"}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {a.area_km2 != null ? `${a.area_km2.toFixed(2)} km²` : "No polygon"}
                    </div>

                    {active && (
                      <div className="flex gap-2 mt-3">
                        <button className="btn" onClick={deleteArea} disabled={busy} type="button">
                          Delete
                        </button>
                        <button className="btn" onClick={copyArea} disabled={busy} type="button">
                          Copy
                        </button>
                        <button
                          className="btn btn-primary"
                          onClick={() => setSponsorModalOpen(true)}
                          disabled={busy || !a.geom}
                          type="button"
                        >
                          Sponsor (Featured)
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t text-xs text-gray-500">
          <div className="font-semibold text-gray-700 mb-2">Legend</div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm bg-green-200 border border-green-300" />
            Owned by you
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-red-200 border border-red-300" />
            Owned by others
          </div>
          <div className="mt-3">
            Tips
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>Click “New Area”, then click around the map to draw a polygon.</li>
              <li>Double-click to finish.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Main panel */}
      <div className="bg-white">
        {!selectedArea ? (
          <div className="p-6 text-sm text-gray-600">Select or create an area to edit.</div>
        ) : (
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-semibold">{areaName}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {areaDisplayKm2 != null ? `${areaDisplayKm2.toFixed(3)} km²` : "—"}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  className="btn"
                  onClick={() => setSponsorModalOpen(true)}
                  disabled={busy || !selectedArea.geom}
                  type="button"
                >
                  Sponsor (Featured)
                </button>

                <button
                  className="btn btn-primary"
                  onClick={saveGeometry}
                  disabled={busy || !draftGeoJson}
                  type="button"
                >
                  Save polygon
                </button>
              </div>
            </div>

            {/* Map */}
            <div className="flex-1 min-h-[420px]">
              <ServiceAreaMap
                key={`map:${selectedArea.id}`}
                cleanerId={cleanerId}
                categoryId={categoryId}
                area={selectedArea}
                onDraftChange={(geojson, km2) => {
                  setDraftGeoJson(geojson);
                  setDraftKm2(km2);
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Sponsor modal */}
      {selectedArea && (
        <AreaSponsorModal
          open={sponsorModalOpen}
          onClose={() => setSponsorModalOpen(false)}
          areaId={selectedArea.id}
          areaName={selectedArea.name || "Untitled"}
          categoryId={categoryId}
          slot={DEFAULT_SLOT}
        />
      )}
    </div>
  );
}
