// src/components/AreaSponsorModal.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

/** ---------- Types ---------- */
type AvailabilityOk = { ok: true; existing: any; available: any };
type AvailabilityErr = { ok: false; error: string };
type Availability = AvailabilityOk | AvailabilityErr;

type PreviewOk = {
  ok: true;
  area_km2: number | string | null;
  monthly_price: number | string | null;
  total_price: number | string | null;
  final_geojson: any | null;
  months?: number;
};
type PreviewErr = { ok: false; error: string };
type PreviewResult = PreviewOk | PreviewErr;

/** Safe numeric coerce */
function toNum(n: unknown): number | null {
  const x = typeof n === "string" ? Number(n) : (n as number);
  return Number.isFinite(x) ? x : null;
}

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

  // (loaded for potential future use)
  const [areaGeoJSON, setAreaGeoJSON] = useState<any | null>(null);
  const [loadingGJ, setLoadingGJ] = useState(false);

  /** Load the service area's GeoJSON when the modal opens */
  useEffect(() => {
    let cancelled = false;

    async function loadGJ() {
      if (!open || !areaId) return;
      setLoadingGJ(true);
      setErr(null);
      try {
        const { data, error } = await supabase
          .from("service_areas")
          .select("gj")
          .eq("id", areaId)
          .maybeSingle();

        if (error) throw error;
        if (!data?.gj) throw new Error("This service area has no geometry saved.");
        if (!cancelled) setAreaGeoJSON(data.gj);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load area geometry.");
      } finally {
        if (!cancelled) setLoadingGJ(false);
      }
    }

    if (open) {
      setErr(null);
      setAvail(null);
      setPreview(null);
      loadGJ();
    }

    return () => {
      cancelled = true;
    };
  }, [open, areaId]);

  /** Build availability URL — include cleaner_id (exclude self) */
  const availabilityUrl = useMemo(() => {
    const qs = new URLSearchParams({
      area_id: areaId,
      slot: String(slot),
      cleaner_id: cleanerId,
      t: String(Date.now()),
    });
    return `/.netlify/functions/area-availability?${qs.toString()}`;
  }, [areaId, slot, cleanerId]);

  /** Fetch availability on open */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
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
        const raw = await res.text().catch(() => "");

        console.log("[area-availability] status:", res.status, res.statusText);
        console.log("[area-availability] content-type:", ct);
        if (raw) console.log("[area-availability] raw:", raw);

        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}\n${raw}`);
        if (!ct.includes("application/json")) throw new Error(`Non-JSON response:\n${raw}`);

        const data: Availability = JSON.parse(raw);
        if (!data || (data as any).ok !== true) {
          const msg =
            (data as AvailabilityErr)?.error ||
            `Server responded without ok=true:\n${JSON.stringify(data, null, 2)}`;
          throw new Error(msg);
        }
        if (!cancelled) setAvail(data);
      } catch (e: any) {
        const msg =
          typeof e?.message === "string" && e.message.startsWith("<")
            ? "Received HTML from server (check Netlify redirects order)."
            : e?.message || "Failed to load availability.";
        if (!cancelled) setErr(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, availabilityUrl]);

  /** Preview pricing — send cleanerId so DB excludes your own records */
  async function runPreview() {
    if (!open) return;
    setPreviewing(true);
    setErr(null);
    setPreview(null);

    try {
      const res = await fetch(`/.netlify/functions/area-preview`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          areaId: areaId,
          slot,
          months: 1,
          drawnGeoJSON: null,
          cleanerId, // <-- IMPORTANT (exclude own areas when calculating availability)
        }),
      });

      const ct = res.headers.get("content-type") || "";
      const raw = await res.text().catch(() => "");

      console.log("[area-preview] status:", res.status, res.statusText);
      console.log("[area-preview] content-type:", ct);
      if (raw) console.log("[area-preview] raw:", raw);

      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}\n${raw}`);
      if (!ct.includes("application/json")) throw new Error(`Non-JSON response:\n${raw}`);

      const data: PreviewResult = JSON.parse(raw);
      if (!data || (data as any).ok !== true) {
        const msg =
          (data as PreviewErr)?.error ||
          `Server responded without ok=true:\n${JSON.stringify(data, null, 2)}`;
        throw new Error(msg);
      }
      setPreview(data);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setPreviewing(false);
    }
  }

  /** Stripe checkout — also pass cleanerId */
  async function goToCheckout() {
    try {
      let token: string | null = null;
      const rawToken = localStorage.getItem("supabase.auth.token");
      if (rawToken) {
        try {
          const parsed = JSON.parse(rawToken);
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
          drawnGeoJSON: null,
        }),
      });

      const ct = res.headers.get("content-type") || "";
      const raw = await res.text().catch(() => "");
      console.log("[checkout] status:", res.status, res.statusText);
      console.log("[checkout] content-type:", ct);
      if (raw) console.log("[checkout] raw:", raw);

      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}\n${raw}`);
      if (!ct.includes("application/json")) throw new Error(`Non-JSON response from checkout:\n${raw}`);

      const data = JSON.parse(raw);
      if (data?.url) {
        window.location.href = data.url; // to Stripe
      } else {
        throw new Error("No checkout URL returned.");
      }
    } catch (e: any) {
      const msg =
        typeof e?.message === "string" && e.message.startsWith("<")
          ? "Received HTML from server (check Netlify redirects order)."
          : e?.message || "Failed to start checkout.";
      setErr(msg);
    }
  }

  if (!open) return null;

  /** Derived state */
  const okAvail = avail && (avail as any).ok;
  const availHasArea =
    (okAvail &&
      (avail as AvailabilityOk).available &&
      (Array.isArray((avail as AvailabilityOk).available?.coordinates)
        ? (avail as AvailabilityOk).available.coordinates.length > 0
        : true)) ||
    false;

  const areaKm2 = preview && (preview as PreviewOk).ok ? toNum((preview as PreviewOk).area_km2) : null;
  const monthly = preview && (preview as PreviewOk).ok ? toNum((preview as PreviewOk).monthly_price) : null;
  const total = preview && (preview as PreviewOk).ok ? toNum((preview as PreviewOk).total_price) : null;

  // Allow billing if availability shows some area OR the preview computed a positive area.
  const canBill = availHasArea || (areaKm2 !== null && areaKm2 > 0);

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
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
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2 whitespace-pre-wrap">
              {err}
            </div>
          )}

          {!loading && !loadingGJ && !err && okAvail && (
            <>
              <div className="text-sm">
                <div className="mb-1">
                  <strong>Result:</strong>{" "}
                  {canBill ? (
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
                  disabled={previewing}
                >
                  {previewing ? "Calculating…" : "Preview price"}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={goToCheckout}
                  disabled={!canBill}
                  title={!canBill ? "This slot currently has no billable area." : undefined}
                >
                  Continue to checkout
                </button>
              </div>

              {preview && (preview as PreviewOk).ok && (
                <div className="mt-3 text-sm space-y-1">
                  <div>
                    <span className="text-gray-500">Area:</span>{" "}
                    {areaKm2 !== null ? `${areaKm2.toFixed(4)} km²` : "–"}
                  </div>
                  <div>
                    <span className="text-gray-500">Monthly price:</span>{" "}
                    {monthly !== null ? `£${monthly.toFixed(2)}` : "–"}
                  </div>
                  <div>
                    <span className="text-gray-500">First charge (months × price):</span>{" "}
                    {total !== null ? `£${total.toFixed(2)}` : "–"}
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
