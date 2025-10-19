// src/components/AreaSponsorModal.tsx
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

// ---- Types for "manage" (existing subscription) ----
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

// ---- Types for "sponsor" preview ----
type PreviewOk = {
  ok: true;
  tier: string;
  slot: number;
  area_km2: number;
  monthly_price: number;
  total_price: number;
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

  // manage
  const [sub, setSub] = useState<GetSubOk["subscription"] | null>(null);

  // preview
  const [areaKm2, setAreaKm2] = useState<number | null>(null);
  const [monthly, setMonthly] = useState<number | null>(null);
  const [tier, setTier] = useState<string | null>(null);

  const title = useMemo(
    () => (mode === "manage" ? `Manage Slot #${slot}` : `Sponsor #${slot}`),
    [mode, slot]
  );

  // Load current sub details in manage mode
  useEffect(() => {
    let cancelled = false;

    async function runManage() {
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

    runManage();
    return () => {
      cancelled = true;
    };
  }, [open, mode, areaId, slot, cleanerId]);

  // Auto preview price in sponsor mode (no “Preview price” button)
  useEffect(() => {
    let cancelled = false;

    async function runPreview() {
      if (!open || mode !== "sponsor") return;
      setLoading(true);
      setErr(null);
      setAreaKm2(null);
      setMonthly(null);
      setTier(null);
      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cleanerId, areaId, slot }),
        });
        const json: PreviewResp = await res.json();
        if (cancelled) return;

        if ("ok" in json && json.ok) {
          setAreaKm2(json.area_km2);
          setMonthly(json.monthly_price);
          setTier(json.tier);
        } else {
          setErr(("error" in json && json.error) || "Failed to preview price.");
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to preview price.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    runPreview();
    return () => {
      cancelled = true;
    };
  }, [open, mode, cleanerId, areaId, slot]);

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
            <div className="space-y-3">
              <div className="text-sm">
                Result: <span className="font-medium">Some part of this area is available for #{slot}.</span>
                <br />
                We’ll only bill the portion that's actually available for this slot.
              </div>

              <div className="rounded border p-3 text-sm text-gray-700 bg-gray-50">
                <div className="flex items-center justify-between">
                  <span>Available area for slot #{slot}:</span>
                  <span className="font-medium">
                    {loading || areaKm2 === null ? "—" : `${areaKm2.toFixed(4)} km²`}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span>Monthly price{tier ? ` (${tier})` : ""}:</span>
                  <span className="font-medium">
                    {loading || monthly === null ? "—" : `£${monthly.toFixed(2)}/month`}
                  </span>
                </div>
              </div>
              {/* The old “Preview price” row has been removed on purpose */}
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
