// src/components/AreaSponsorModal.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Availability =
  | {
      ok: true;
      existing: any;   // GeoJSON (MultiPolygon)
      available: any;  // GeoJSON (Polygon or MultiPolygon)
    }
  | { ok: false; error: string };

type PreviewResult =
  | {
      ok: true;
      area_km2: number;
      monthly_price: number;
      total_price: number;
      final_geojson: any | null;
    }
  | { ok: false; error: string };

export default function AreaSponsorModal({
  open,
  onClose,
  cleanerId,
  areaId,
  slot,
}: {
  open: boolean;
  onClose: () => void;
  cleanerId: string;
  areaId: string;
  slot: 1 | 2 | 3;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);

  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  // the service area's stored geometry (we'll send this as drawnGeoJSON)
  const [areaGeoJSON, setAreaGeoJSON] = useState<any | null>(null);
  const [loadingGJ, setLoadingGJ] = useState(false);

  // --- Load the service area's GeoJSON when the modal opens ---
  useEffect(() => {
    let cancelled = false;

    async function loadViaTable() {
      const { data, error, status } = await supabase
        .from("service_areas")
        .select("gj")
        .eq("id", areaId)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn("service_areas gj fetch error", status, error);
        throw error;
      }
      if (!data?.gj) throw new Error("This service area has no geometry saved.");
      return data.gj;
    }

    async function loadViaRpcFallback() {
      // Optional RPC fallback if you created:
      // create or replace function get_service_area_gj(p_area_id uuid)
      // returns jsonb language sql stable security definer
      // as $$ select gj from service_areas where id = p_area_id; $$;
      const { data, error } = await supabase.rpc("get_service_area_gj", {
        p_area_id: areaId,
      });
      if (error) throw error;
      if (!data) throw new Error("No geometry found for this area.");
      return data;
    }

    async function loadGJ() {
      if (!open || !areaId) return;
      setLoadingGJ(true);
      setErr(null);
      try {
        let gj: any;
        try {
          gj = await loadViaTable();
        } catch {
          // Fallback to RPC (helps avoid 400 quirks)
          gj = await loadViaRpcFallback();
        }
        if (!cancelled) setAreaGeoJSON(gj);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load area geometry.");
      } finally {
        if (!cancelled) setLoadingGJ(false);
      }
    }

    loadGJ();
    return () => {
      cancelled = true;
    };
  }, [open, areaId]);

  // Build URL with cache-buster; call function path directly to bypass SPA.
  const availabilityUrl = useMemo(() => {
    const qs = new URLSearchParams({
      area_id: areaId,
      slot: String(slot),
      t: String(Date.now()),
    });
    return `/.netlify/functions/area-availability?${qs.toString()}`;
  }, [areaId, slot]);

  // --- Availability check (GET) ---
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    async function run() {
      setLoading(true);
      setErr(null);
      setAvail(null);
      setPreview(null);
      try {
        const res = await fetch(availabilityUrl, {
          method: "GET",
          headers: { accept: "application/json" },
        });

        const ct = res.headers.get("content-type") || "";
        if (!res.ok || ct.includes("text/html")) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Request failed (${res.status})`);
        }

        const data = (await res.json()) as Availability;
        if (!("ok" in data) || !data.ok) {
          throw new Error((data as any)?.error || "Availability failed.");
        }
        if (!cancelled) setAvail(data);
      } catch (e: any) {
        const msg: string =
          typeof e?.message === "string" && e.message.startsWith("<")
            ? "Received HTML from server (check Netlify redirects order)."
            : e?.message || "Failed to load availability.";
        if (!cancelled) setErr(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [open, availabilityUrl]);

  // --- Price preview (POST) ---
  async function runPreview() {
    if (!open) return;
    if (!areaGeoJSON) {
      setErr("Missing area geometry; please try reloading the page.");
      return;
    }
    setPreviewing(true);
    setErr(null);
    setPreview(null);
    try {
      const res = await fetch(`/.netlify/functions/area-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          area_id: areaId,
          slot,
          months: 1,
          drawnGeoJSON: areaGeoJSON, // required by the function
        }),
      });

      const ct = res.headers.get("content-type") || "";
      if (!res.ok || ct.includes("text/html")) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Preview failed (${res.status})`);
      }

      const data = (await res.json()) as PreviewResult;
      if (!("ok" in data) || !data.ok) {
        throw new Error((data as any)?.error || "Preview failed.");
      }
      setPreview(data);
    } catch (e: any) {
      const msg: string =
        typeof e?.message === "string" && e.message.startsWith("<")
          ? "Received HTML from server (check Netlify redirects order)."
          : e?.message || "Failed to preview.";
      setErr(msg);
    } finally {
      setPreviewing(false);
    }
  }

  // --- Checkout (POST) ---
  async function goToCheckout() {
    try {
      if (!areaGeoJSON) {
        setErr("Missing area geometry; please try reloading the page.");
        return;
      }

      // pull supabase token, if available (your function may require auth)
      let token: string | null = null;
      const raw = localStorage.getItem("supabase.auth.token");
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          token = parsed?.currentSession?.access_token ?? null;
        } catch {}
      }

      const res = await fetch(`/.netlify/functions/sponsored-checkout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          cleanerId,
          areaId,
          slot,
          months: 1,
          drawnGeoJSON: areaGeoJSON,
        }),
      });

      const ct = res.headers.get("content-type") || "";
      if (!res.ok || ct.includes("text/html")) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Checkout failed (${res.status})`);
      }

      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url; // Stripe Checkout
      } else {
        throw new Error("No checkout URL returned.");
      }
    } catch (e: any) {
      const msg: string =
        typeof e?.message === "string" && e.message.startsWith("<")
          ? "Received HTML from server (check Netlify redirects order)."
          : e?.message || "Failed to start checkout.";
      setErr(msg);
    }
  }

  if (!open) return null;

  // derived helper about availability
  const hasAvailable =
    (avail as any)?.ok &&
    (avail as any)?.available &&
    (Array.isArray((avail as any).available?.coordinates)
      ? (avail as any).available.coordinates.length > 0
      : true);

  // Safe number extraction for preview block to prevent crashes
  const km2 = Number((preview as any)?.ok ? (preview as any).area_km2 : NaN);
  const monthly = Number((preview as any)?.ok ? (preview as any).monthly_price : NaN);
  const total = Number((preview as any)?.ok ? (preview as any).total_price : NaN);
  const previewNumbersValid =
    Number.isFinite(km2) && Number.isFinite(monthly) && Number.isFinite(total);

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* modal */}
      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">Sponsor #{slot}</h3>
          <button
            type="button"
            className="text-sm px-2 py-1 rounded hover:bg-black/5"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          {(loading || loadingGJ) && <div className="text-sm text-gray-600">Loading…</div>}

          {!loading && !loadingGJ && err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}

          {!loading && !loadingGJ && !err && avail && "ok" in avail && avail.ok && (
            <>
              <div className="text-sm">
                <div className="mb-1">
                  <strong>Result:</strong>{" "}
                  {hasAvailable ? (
                    <span className="text-green-700">Some part of this area is available for #{slot}.</span>
                  ) : (
                    <span className="text-gray-700">
                      No billable area is currently available for #{slot} inside this Service Area.
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  We’ll only bill the portion that’s actually available for this slot.
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  className="btn"
                  onClick={runPreview}
                  disabled={previewing || !areaGeoJSON}
                >
                  {previewing ? "Calculating…" : "Preview price"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={goToCheckout}
                  disabled={!hasAvailable ||
