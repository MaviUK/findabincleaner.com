import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** BUSINESS id (cleaners.id). */
  cleanerId: string;
  areaId: string;
  slot: 1 | 2 | 3;
  mode?: "sponsor" | "manage";
};

/** ----- Manage types ----- */
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

/** ----- Preview types ----- */
type PreviewOk = {
  ok: true;
  slot: number;
  tier: string;
  area_km2: number;
  monthly_price: number;
  total_price: number;
  final_geojson: any | null;
};
type PreviewErr = { ok?: false; error?: string };
type PreviewResp = PreviewOk | PreviewErr;

export default function AreaSponsorModal({
  open,
  onClose,
  cleanerId,
  areaId,
  slot,
  mode = "sponsor",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sub, setSub] = useState<GetSubOk["subscription"] | null>(null);

  // preview state
  const [prevLoading, setPrevLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewOk | null>(null);
  const [prevErr, setPrevErr] = useState<string | null>(null);

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

  async function previewPrice() {
    setPrevLoading(true);
    setPrevErr(null);
    setPreview(null);
    try {
      const res = await fetch("/.netlify/functions/sponsored-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cleanerId,
          areaId,
          slot,
          // If you ever send a hand-drawn shape from the map, pass it as `drawnGeoJSON`
        }),
      });
      const json: PreviewResp = await res.json();
      if (!("ok" in json) || !json.ok) {
        throw new Error(("error" in json && json.error) || "Preview unavailable");
      }
      setPreview(json);
    } catch (e: any) {
      setPrevErr(e?.message || "Preview failed");
    } finally {
      setPrevLoading(false);
    }
  }

  async function proceedToCheckout() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cleanerId,
          areaId,
          slot,
          // drawnGeoJSON: ... // optional if you add custom-drawn purchase
        }),
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
                      ? `£${(sub.price_monthly_pennies / 100).toFixed(2)}/mo`
                      : "—"}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-sm">
                Result: <span className="font-medium">Some part of this area is available for #{slot}.</span>
                <br />
                We’ll only bill the portion that's actually available for this slot.
              </div>

              {/* Preview panel */}
              <div className="rounded border p-3 bg-gray-50">
                <div className="flex items-center justify-between gap-2">
                  <button className="btn" onClick={previewPrice} disabled={prevLoading}>
                    {prevLoading ? "Previewing…" : "Preview price"}
                  </button>
                  {prevErr && (
                    <div className="text-xs text-red-600">{prevErr}</div>
                  )}
                </div>

                {preview && (
                  <div className="mt-3 text-sm space-y-1">
                    <div>
                      <span className="font-medium">Tier:</span> {preview.tier} (#{preview.slot})
                    </div>
                    <div>
                      <span className="font-medium">Billable area:</span>{" "}
                      {preview.area_km2.toFixed(4)} km²
                    </div>
                    <div>
                      <span className="font-medium">Monthly price:</span>{" "}
                      £{preview.monthly_price.toFixed(2)}
                    </div>
                  </div>
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
