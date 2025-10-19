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

type PreviewRespOk = {
  ok: true;
  area_km2: number;              // ← the *actual* available area for this slot
  monthly_price: number;
  total_price: number;
  final_geojson?: any | null;    // optional; server may send clipped shape
};
type PreviewRespErr = { ok?: false; error?: string };
type PreviewResp = PreviewRespOk | PreviewRespErr;

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

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRespOk | null>(null);

  const title = useMemo(
    () => (mode === "manage" ? `Manage Slot #${slot}` : `Sponsor #${slot}`),
    [mode, slot]
  );

  // -------- Manage: load current subscription summary --------
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

  // -------- Sponsor: auto-preview area + price on open --------
  useEffect(() => {
    if (!open || mode !== "sponsor") return;
    previewPrice(); // fire-and-forget; user can still click "Preview price" again to refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, areaId, slot, cleanerId]);

  async function previewPrice() {
    setPreviewLoading(true);
    setPreviewErr(null);
    try {
      const res = await fetch("/.netlify/functions/sponsored-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cleanerId,    // business id
          drawnGeoJSON: null, // using saved geometry; wire a drawing flow later if needed
          months: 1,
          // server can infer slot=1/2/3 via stored procedure or you can add it:
          // slot,
        }),
      });
      const json: PreviewResp = await res.json();
      if (!json || (json as any).ok === false) {
        throw new Error((json as PreviewRespErr)?.error || "Preview failed");
      }
      setPreview(json as PreviewRespOk);
    } catch (e: any) {
      setPreviewErr(e?.message || "Preview failed");
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

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
        body: JSON.stringify({
          cleanerId,
          areaId,
          slot,
          months: 1,
          drawnGeoJSON: null,
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

  const areaText =
    preview && Number.isFinite(preview.area_km2)
      ? `${preview.area_km2.toFixed(4)} km²`
      : null;

  const priceText =
    preview && Number.isFinite(preview.monthly_price)
      ? `£${preview.monthly_price.toFixed(2)}/month`
      : null;

  const disableCheckout = mode === "sponsor" && (!!preview && preview.area_km2 === 0);

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
                      ? `£${(sub.price_monthly_pennies / 100).toFixed(2)}/month`
                      : "—"}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-sm">
                <div className="mb-1">
                  Result: <span className="font-medium">Some part of this area is available for #{slot}.</span>
                </div>
                <div className="text-gray-600">
                  We’ll only bill the portion that’s actually available for this slot.
                </div>
              </div>

              {/* Live preview block */}
              <div className="rounded border p-2 text-sm">
                {previewLoading && <div className="text-gray-600">Calculating available area…</div>}
                {previewErr && (
                  <div className="text-red-700">Preview failed: {previewErr}</div>
                )}
                {!previewLoading && !previewErr && preview && (
                  <div className="space-y-1">
                    <div>
                      <span className="font-medium">Available area for slot #{slot}:</span>{" "}
                      {areaText ?? "—"}
                    </div>
                    <div>
                      <span className="font-medium">Monthly price:</span>{" "}
                      {priceText ?? "—"}
                    </div>
                    {preview.area_km2 === 0 && (
                      <div className="text-amber-700">
                        Nothing is currently available in your shape for this slot.
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-2">
                  <button className="btn" onClick={previewPrice} disabled={previewLoading}>
                    {previewLoading ? "Previewing…" : "Preview price"}
                  </button>
                </div>
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
            <button
              className="btn btn-primary"
              onClick={proceedToCheckout}
              disabled={loading || disableCheckout}
              title={disableCheckout ? "No available area to purchase for this slot." : undefined}
            >
              Continue to checkout
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
