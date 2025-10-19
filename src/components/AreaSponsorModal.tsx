import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** BUSINESS id (cleaners.id). */
  cleanerId: string;
  areaId: string;
  slot: 1 | 2 | 3;
  mode?: "sponsor" | "manage";

  /** Optional hooks so the parent can draw/clear the map overlay. */
  onPreviewGeoJSON?: (multi: any) => void;
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

  // preview state (sponsor mode)
  const [areaKm2, setAreaKm2] = useState<number | null>(null);
  const [monthlyPrice, setMonthlyPrice] = useState<number | null>(null);

  const title = useMemo(
    () => (mode === "manage" ? `Manage Slot #${slot}` : `Sponsor #${slot}`),
    [mode, slot]
  );

  // ----- Load current sub details (manage) -----
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
          const msg = ("error" in json && json.error) || "Failed to load subscription.";
          setErr(msg);
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

  // ----- Preview (sponsor) – compute available geojson + price and draw overlay -----
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!open || mode !== "sponsor") return;
      setLoading(true);
      setErr(null);
      setAreaKm2(null);
      setMonthlyPrice(null);

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cleanerId, areaId, slot }),
        });
        const json = await res.json();
        if (cancelled) return;

        if (!res.ok || json?.error) {
          setErr(json?.error || "Failed to compute available area");
        } else {
          setAreaKm2(typeof json.area_km2 === "number" ? json.area_km2 : null);
          setMonthlyPrice(typeof json.monthly_price === "number" ? json.monthly_price : null);

          // draw overlay on the map
          if (json.final_geojson && onPreviewGeoJSON) {
            onPreviewGeoJSON(json.final_geojson);
          }
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to compute available area");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();

    // clear overlay when modal unmounts/closes
    return () => {
      if (onClearPreview) onClearPreview();
      cancelled = true;
    };
  }, [open, mode, cleanerId, areaId, slot, onPreviewGeoJSON, onClearPreview]);

  async function cancelAtPeriodEnd() {
    setLoading(true);
    setErr(null);
    try {
      const body = { businessId: cleanerId, areaId, slot };
      const res = await fetch("/.netlify/functions/subscription-cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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
            <div className="text-sm space-y-2">
              <div>
                Result: Some part of this area is available for #{slot}. We’ll only bill the
                portion that's actually available for this slot.
              </div>
              <div className="rounded border p-2 text-sm">
                <div>
                  <span className="font-medium">Available area for slot #{slot}:</span>{" "}
                  {typeof areaKm2 === "number" ? `${areaKm2.toFixed(4)} km²` : "—"}
                </div>
                <div>
                  <span className="font-medium">Monthly price</span>
                  {slot === 1 ? " (Gold)" : slot === 2 ? " (Silver)" : " (Bronze)"}:{" "}
                  {typeof monthlyPrice === "number" ? `£${monthlyPrice.toFixed(2)}/month` : "—"}
                </div>
              </div>
              {loading && <div className="text-xs text-gray-500">Computing preview…</div>}
            </div>
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
