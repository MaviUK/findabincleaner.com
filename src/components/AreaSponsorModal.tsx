import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** BUSINESS id (cleaners.id) */
  cleanerId: string;
  areaId: string;
  slot: 1 | 2 | 3;
  mode?: "sponsor" | "manage";
  /** OPTIONAL: if you draw the billable polygon on the map */
  onPreviewGeoJSON?: (multi: any | null) => void;
  onClearPreview?: () => void;
};

type GetSubOk = {
  ok: true;
  subscription: {
    area_name: string | null;
    status: string | null;
    current_period_end: string | null;
    price_monthly_pennies: number | null;
  };
};
type GetSubErr = { ok: false; error?: string; notFound?: boolean };
type GetSubResp = GetSubOk | GetSubErr;

type PreviewOk = {
  ok: true;
  area_km2: number;
  monthly_price: number;
  final_geojson: any | null;
};
type PreviewErr = { ok: false; error?: string };
type PreviewResp = PreviewOk | PreviewErr;

export default function AreaSponsorModal({
  open,
  onClose,
  cleanerId,
  areaId,
  slot,
  mode = "sponsor",
  onPreviewGeoJSON,
  onClearPreview,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sub, setSub] = useState<GetSubOk["subscription"] | null>(null);

  // preview state
  const [computing, setComputing] = useState(false);
  const [previewKm2, setPreviewKm2] = useState<number | null>(null);
  const [previewPrice, setPreviewPrice] = useState<number | null>(null);

  const title = useMemo(
    () => (mode === "manage" ? `Manage Slot #${slot}` : `Sponsor #${slot}`),
    [mode, slot]
  );

  // Load current sub details in manage mode
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!open || mode !== "manage") return;
      setLoading(true);
      setErr(null);
      setSub(null);
      try {
        const body = { businessId: cleanerId, areaId, slot };
        const res = await fetch("/.netlify/functions/subscription-get", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json: GetSubResp = await res.json();
        if (cancelled) return;

        if ("ok" in json && json.ok) {
          setSub(json.subscription);
        } else if ("notFound" in json && json.notFound) {
          setErr("No active subscription was found for this slot.");
        } else {
          setErr(("error" in json && json.error) || "Failed to load subscription.");
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load subscription.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [open, mode, areaId, slot, cleanerId]);

  // Preview the billable area + price in sponsor mode
  useEffect(() => {
    if (!open || mode !== "sponsor") return;

    let cancelled = false;
    setComputing(true);
    setErr(null);
    setPreviewKm2(null);
    setPreviewPrice(null);
    onPreviewGeoJSON?.(null);

    // 10s timeout so we never spin forever
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 10000);

    (async () => {
      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cleanerId, areaId, slot }),
          signal: controller.signal,
        });

        const json: PreviewResp = await res.json();

        if (cancelled) return;

        if ("ok" in json && json.ok) {
          setPreviewKm2(json.area_km2);
          setPreviewPrice(json.monthly_price);
          if (json.final_geojson) onPreviewGeoJSON?.(json.final_geojson);
        } else {
          // clear any drawn overlay if server reports an error
          onClearPreview?.();
          setErr(("error" in json && json.error) || "Failed to compute available area.");
        }
      } catch (e: any) {
        if (!cancelled) {
          onClearPreview?.();
          setErr(e?.name === "AbortError" ? "Preview timed out." : (e?.message || "Preview failed."));
        }
      } finally {
        if (!cancelled) setComputing(false);
        clearTimeout(to);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(to);
      controller.abort();
    };
  }, [open, mode, cleanerId, areaId, slot, onPreviewGeoJSON, onClearPreview]);

  async function cancelAtPeriodEnd() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/.netlify/functions/subscription-cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId: cleanerId, areaId, slot }),
      });
      const json: { ok?: boolean; error?: string } = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Cancel failed");
      onClose();
      alert("Your sponsorship will be cancelled at the end of the current period.");
    } catch (e: any) {
      setErr(e?.message || "Cancel failed");
    } finally {
      setLoading(false);
    }
  }

  async function proceedToCheckout() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cleanerId, areaId, slot }),
      });
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data?.error || "Could not start checkout");
      }
    } catch (e: any) {
      setErr(e?.message || "Could not start checkout");
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold">{title}</h3>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}

          {mode === "manage" ? (
            <>
              {loading && <div className="text-sm text-gray-600">Loading…</div>}
              {!loading && sub && (
                <div className="text-sm space-y-1">
                  <div>
                    <span className="font-medium">Area:</span> {sub.area_name || "—"}
                  </div>
                  <div>
                    <span className="font-medium">Status:</span> {sub.status || "unknown"}
                  </div>
                  <div>
                    <span className="font-medium">Next renewal:</span>{" "}
                    {sub.current_period_end
                      ? new Date(sub.current_period_end).toLocaleString()
                      : "—"}
                  </div>
                  <div>
                    <span className="font-medium">Price:</span>{" "}
                    {typeof sub.price_monthly_pennies === "number"
                      ? `${(sub.price_monthly_pennies / 100).toFixed(2)} GBP/mo`
                      : "—"}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-sm">
                Some part of this area is available for #{slot}. We’ll only bill the portion that’s
                actually available for this slot.
              </div>
              <div className="rounded border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>Available area for slot #{slot}:</span>
                  <span className="font-medium">
                    {previewKm2 != null ? `${previewKm2.toFixed(5)} km²` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span>Monthly price ({slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze"}):</span>
                  <span className="font-medium">
                    {previewPrice != null ? `£${previewPrice.toFixed(2)}/month` : "—"}
                  </span>
                </div>
                {computing && (
                  <div className="mt-2 text-xs text-gray-500">Computing preview…</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          {mode === "manage" ? (
            <button className="btn" onClick={cancelAtPeriodEnd} disabled={loading}>
              Cancel at period end
            </button>
          ) : (
            <button className="btn btn-primary" onClick={proceedToCheckout} disabled={loading}>
              Continue to checkout
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
