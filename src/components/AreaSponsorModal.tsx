// src/components/AreaSponsorModal.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Availability =
  | { ok: true; existing: any; available: any }
  | { ok: false; error: string };

type PreviewOk = {
  ok: true;
  area_km2: number;
  monthly_price: number;
  total_price: number;
  final_geojson: any | null;
};
type PreviewResult = PreviewOk | { ok: false; error: string };

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

  // service area geometry we’ll send as drawnGeoJSON
  const [areaGeoJSON, setAreaGeoJSON] = useState<any | null>(null);
  const [loadingGJ, setLoadingGJ] = useState(false);

  // --- Load the service area's GeoJSON when the modal opens ---
  useEffect(() => {
    let cancelled = false;

    async function loadViaRpc() {
      // Prefer an RPC you own: get_service_area_gj(p_area_id uuid)
      const { data, error } = await supabase.rpc("get_service_area_gj", {
        p_area_id: areaId,
      });
      if (error) throw error;
      if (!data) throw new Error("No geometry found for this area.");
      return data;
    }

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

    async function loadGJ() {
      if (!open || !areaId) return;
      setLoadingGJ(true);
      setErr(null);
      try {
        let gj: any;
        try {
          gj = await loadViaRpc();
        } catch {
          gj = await loadViaTable();
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

  // Availability URL (call function path directly to dodge SPA redirects)
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
          throw new Error(
            text || `Availability failed (${res.status} ${res.statusText})`
          );
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
          drawnGeoJSON: areaGeoJSON,
        }),
      });

      const ct = res.headers.get("content-type") || "";
      if (!res.ok || !ct.includes("application/json")) {
        const text = await res.text().catch(() => "");
        throw new Error(
          text || `Preview failed (${res.status} ${res.statusText})`
        );
      }

      const data = (await res.json()) as PreviewResult;
      if (!("ok" in data)) {
        throw new Error("Malformed response from preview.");
      }
      if (!data.ok) {
        throw new Error(data.error || "Preview failed.");
      }
      setPreview(data);
    } catch (e: any) {
      setErr(
        typeof e?.message === "string" && e.message.startsWith("<")
          ? "Received HTML from server (check Netlify redirects order)."
          : e?.message || "Failed to preview."
      );
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
      if (!res.ok || !ct.includes("application/json")) {
        const text = await res.text().catch(() => "");
        throw new Error(
          text || `Checkout failed (${res.status} ${res.statusText})`
        );
      }

      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No checkout URL returned.");
      }
    } catch (e: any) {
      setErr(
        typeof e?.message === "string" && e.message.startsWith("<")
          ? "Received HTML from server (check Netlify redirects order)."
          : e?.message || "Failed to start checkout."
      );
    }
  }

  if (!open) return null;

  const hasAvailable =
    (avail as any)?.ok &&
    (avail as any)?.available &&
    (Array.isArray((avail as any).available?.coordinates)
      ? (avail as any).available.coordinates.length > 0
      : true);

  const numbers =
    preview && "ok" in preview && preview.ok
      ? {
          km2: Number(preview.area_km2),
          monthly: Number(preview.monthly_price),
          total: Number(preview.total_price),
        }
      : null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">Sponsor #{slot}</h3>
          <button type="button" className="text-sm px-2 py-1 rounded hover:bg-black/5" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          {(loading || loadingGJ) && (
            <div className="text-sm text-gray-600">Loading…</div>
          )}

          {!loading && !loadingGJ && err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 whitespace-pre-wrap">
              {err}
            </div>
          )}

          {!loading && !loadingGJ && !err && avail && "ok" in avail && avail.ok && (
            <>
              <div className="text-sm">
                <div className="mb-1">
                  <strong>Result:</strong>{" "}
                  {hasAvailable ? (
                    <span className="text-green-700">
                      Some part of this area is available for #{slot}.
                    </span>
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
                  disabled={!hasAvailable || !areaGeoJSON}
                >
                  Continue to checkout
                </button>
              </div>

              {numbers && Number.isFinite(numbers.km2) && Number.isFinite(numbers.monthly) && Number.isFinite(numbers.total) && (
                <div className="mt-3 text-sm space-y-1">
                  <div>
                    <span className="text-gray-500">Area:</span> {numbers.km2.toFixed(4)} km²
                  </div>
                  <div>
                    <span className="text-gray-500">Monthly price:</span> £{numbers.monthly.toFixed(2)}
                  </div>
                  <div>
                    <span className="text-gray-500">First charge (months × price):</span> £{numbers.total.toFixed(2)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
