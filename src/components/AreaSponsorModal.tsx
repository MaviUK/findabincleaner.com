import { useEffect, useMemo, useState } from "react";

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

  // build query string with cache-buster
  const availabilityUrl = useMemo(() => {
    const qs = new URLSearchParams({
      area_id: areaId,
      slot: String(slot),
      t: String(Date.now()), // 👈 cache-buster so we don't get 304 stuck states
    });
    return `/api/area/availability?${qs.toString()}`;
  }, [areaId, slot]);

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
          // cache: "no-store", // optional extra
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Request failed (${res.status})`);
        }
        const data = (await res.json()) as Availability;
        if (!("ok" in data) || !data.ok) {
          throw new Error((data as any)?.error || "Availability failed.");
        }
        if (!cancelled) setAvail(data);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load availability.");
      } finally {
        if (!cancelled) setLoading(false); // 👈 always clear the spinner
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [open, availabilityUrl]);

  async function runPreview() {
    if (!open) return;
    setPreviewing(true);
    setErr(null);
    setPreview(null);
    try {
      const res = await fetch(`/api/area/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          area_id: areaId,
          slot,
          months: 1,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Preview failed (${res.status})`);
      }
      const data = (await res.json()) as PreviewResult;
      if (!("ok" in data) || !data.ok) {
        throw new Error((data as any)?.error || "Preview failed.");
      }
      setPreview(data);
    } catch (e: any) {
      setErr(e?.message || "Failed to preview.");
    } finally {
      setPreviewing(false);
    }
  }

  async function goToCheckout() {
    try {
      // pull supabase token, if available (your function may require auth)
      let token: string | null = null;
      const raw = localStorage.getItem("supabase.auth.token");
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          token = parsed?.currentSession?.access_token ?? null;
        } catch {}
      }

      const res = await fetch(`/api/sponsored/checkout`, {
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
        }),
      });

      if (!res.ok) {
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
      setErr(e?.message || "Failed to start checkout.");
    }
  }

  if (!open) return null;

  // tiny helper about availability
  const hasAvailable =
    (avail as any)?.ok &&
    (avail as any)?.available &&
    (Array.isArray((avail as any).available?.coordinates)
      ? (avail as any).available.coordinates.length > 0
      : true);

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* modal */}
      <div className="relative w-full max-w-xl rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-lg font-semibold">Sponsor #{slot}</h3>
          <button className="text-sm px-2 py-1 rounded hover:bg-black/5" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          {loading && <div className="text-sm text-gray-600">Loading availability…</div>}

          {!loading && err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}

          {!loading && !err && avail && "ok" in avail && avail.ok && (
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
                <button className="btn" onClick={runPreview} disabled={previewing}>
                  {previewing ? "Calculating…" : "Preview price"}
                </button>
                <button className="btn btn-primary" onClick={goToCheckout} disabled={!hasAvailable}>
                  Continue to checkout
                </button>
              </div>

              {preview && "ok" in preview && preview.ok && (
                <div className="mt-3 text-sm space-y-1">
                  <div>
                    <span className="text-gray-500">Area:</span> {preview.area_km2.toFixed(4)} km²
                  </div>
                  <div>
                    <span className="text-gray-500">Monthly price:</span> £{preview.monthly_price.toFixed(2)}
                  </div>
                  <div>
                    <span className="text-gray-500">First charge (months × price):</span> £
                    {preview.total_price.toFixed(2)}
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
