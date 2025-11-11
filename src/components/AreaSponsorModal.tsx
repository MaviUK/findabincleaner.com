// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  businessId: string;
  areaId: string;
  areaName?: string;
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;
};

function money(n: number, c = "GBP") {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: c,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `£${n.toFixed(2)}`;
  }
}

export default function AreaSponsorModal({
  open,
  onClose,
  businessId,
  areaId,
  areaName,
  onPreviewGeoJSON,
  onClearPreview,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [totalKm2, setTotalKm2] = useState<number | null>(null);
  const [availableKm2, setAvailableKm2] = useState<number | null>(null);

  const [ratePerKm2, setRatePerKm2] = useState<number>(1);
  const [floorMonthly, setFloorMonthly] = useState<number>(1);
  const [currency, setCurrency] = useState<string>("GBP");

  const [soldOut, setSoldOut] = useState<boolean>(false);
  const [soldTo, setSoldTo] = useState<string | null>(null);

  const monthly = useMemo(() => {
    const km2 = availableKm2 ?? 0;
    const raw = Math.max(km2 * ratePerKm2, floorMonthly);
    return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : 0;
  }, [availableKm2, ratePerKm2, floorMonthly]);

  useEffect(() => {
    if (!open) return;
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, areaId, businessId]);

  async function loadPreview() {
    setLoading(true);
    setError(null);
    setSoldOut(false);
    setSoldTo(null);
    try {
      const res = await fetch("/.netlify/functions/sponsored-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId, areaId, slot: 1 }),
      });
      const j = await res.json();

      if (!res.ok || j?.ok === false) {
        setError(j?.error || `Preview failed${res.ok ? "" : ` (${res.status})`}.`);
        setAvailableKm2(0);
        onClearPreview && onClearPreview();
        return;
      }

      setSoldOut(Boolean(j.sold_out));
      setSoldTo(j.sold_to_business_id ?? null);

      const km2 = Number(j.area_km2 ?? 0);
      setAvailableKm2(Number.isFinite(km2) ? km2 : 0);

      if (typeof j.total_km2 === "number") setTotalKm2(j.total_km2);
      if (typeof j.rate_per_km2 === "number") setRatePerKm2(j.rate_per_km2);
      if (typeof j.floor_monthly === "number") setFloorMonthly(j.floor_monthly);
      if (j.unit_currency) setCurrency(String(j.unit_currency).toUpperCase());

      if (j.geojson && onPreviewGeoJSON) onPreviewGeoJSON(j.geojson);
      if (!j.geojson && onClearPreview) onClearPreview();
    } catch (e: any) {
      setError(e?.message || "Preview error");
      setAvailableKm2(0);
      onClearPreview && onClearPreview();
    } finally {
      setLoading(false);
    }
  }

  async function startCheckout() {
    setCheckingOut(true);
    setError(null);
    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId, areaId, slot: 1 }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok || !j?.url) {
        setError(j?.error || `Checkout failed${res.ok ? "" : ` (${res.status})`}.`);
        setCheckingOut(false);
        return;
      }
      window.location.href = j.url;
    } catch (e: any) {
      setError(e?.message || "Checkout error");
      setCheckingOut(false);
    }
  }

  const buyDisabled =
    loading || checkingOut || soldOut || availableKm2 === null || availableKm2 <= 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white w-[640px] max-w-[95vw] rounded-xl shadow-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-lg">Sponsor — {areaName || "Area"}</h3>
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        <div className="rounded border p-2 mb-3 text-sm bg-emerald-50 text-emerald-800">
          Featured sponsorship makes you first in local search results. Preview highlights the
          purchasable sub-region.
        </div>

        {soldOut && (
          <div className="rounded border p-2 mb-3 text-sm bg-red-50 text-red-700">
            This featured slot is already owned by another business.
          </div>
        )}
        {error && (
          <div className="rounded border p-2 mb-3 text-sm bg-red-50 text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500 mb-1">Total area</div>
            <div className="font-semibold">
              {totalKm2 === null ? "—" : `${totalKm2.toFixed(3)} km²`}
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500 mb-1">Available area</div>
            <div className="font-semibold">
              {availableKm2 === null ? "Loading..." : `${availableKm2.toFixed(3)} km²`}
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500 mb-1">Price per km² / month</div>
            <div className="font-semibold">
              {money(ratePerKm2, currency)} <div className="text-[10px] text-gray-500">From server</div>
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500 mb-1">Minimum monthly</div>
            <div className="font-semibold">
              {money(floorMonthly, currency)} <div className="text-[10px] text-gray-500">Floor price</div>
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500 mb-1">Your monthly price</div>
            <div className="font-semibold">
              {availableKm2 === null ? "Loading..." : money(monthly, currency)}
            </div>
          </div>
          <div className="rounded border p-3">
            <div className="text-xs text-gray-500 mb-1">Coverage</div>
            <div className="font-semibold">
              {totalKm2 && availableKm2 !== null && totalKm2 > 0
                ? `${Math.min(100, (availableKm2 / totalKm2) * 100).toFixed(1)}% of your polygon`
                : "100.0% of your polygon"}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={checkingOut || loading}>
            Cancel
          </button>
          <button
            className={`btn btn-primary ${buyDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={startCheckout}
            disabled={buyDisabled}
            title={
              soldOut
                ? "Already owned by another business"
                : availableKm2 !== null && availableKm2 <= 0
                ? "No purchasable area available"
                : "Proceed to checkout"
            }
          >
            {checkingOut ? "Redirecting..." : soldOut ? "Sold out" : "Buy now"}
          </button>
        </div>
      </div>
    </div>
  );
}
