import React, { useEffect, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  businessId: string;
  areaId: string;

  // Optional extras – only used when the caller wants map highlighting
  areaName?: string;
  onPreviewGeoJSON?: (multi: any | null) => void;
  onClearPreview?: () => void;
};

type PreviewState = {
  total_km2: number;
  available_km2: number;
  price_per_km2: number;
  monthly_price: number;
  min_monthly: number;
  coverage_pct: number;
  sold_out: boolean;
  reason?: string | null;
};

const fmtKm2 = (n: number | null | undefined) =>
  n == null || Number.isNaN(n) ? "—" : `${n.toFixed(3)} km²`;

const fmtMoney = (n: number | null | undefined) =>
  n == null || Number.isNaN(n) ? "—" : `£${n.toFixed(2)}`;

const fmtPercent = (n: number | null | undefined) =>
  n == null || Number.isNaN(n) ? "—" : `${n.toFixed(1)}%`;

const initialPreview: PreviewState = {
  total_km2: 0,
  available_km2: 0,
  price_per_km2: 0,
  monthly_price: 0,
  min_monthly: 0,
  coverage_pct: 0,
  sold_out: false,
  reason: undefined,
};

const AreaSponsorModal: React.FC<Props> = ({
  open,
  onClose,
  businessId,
  areaId,
  areaName,
  onPreviewGeoJSON,
  onClearPreview,
}) => {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewState>(initialPreview);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load preview whenever modal opens
  useEffect(() => {
    if (!open || !areaId || !businessId) return;

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      setPreviewError(null);
      setPreview(initialPreview);

      // Clear any existing highlight on the map if parent provided a callback
      onClearPreview?.();

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId,
            cleanerId: businessId, // back-compat with older API
            areaId,
            slot: 1,
          }),
        });

        if (!res.ok) {
          throw new Error(`Preview failed (${res.status})`);
        }

        const json = await res.json();

        if (!json || json.ok === false) {
          throw new Error(json?.message || "Preview failed");
        }

        // Be tolerant about field names – map what we expect
        const d = json.preview || json;

        const next: PreviewState = {
          total_km2:
            Number(d.total_km2 ?? d.totalKm2 ?? d.total_area_km2 ?? 0) || 0,
          available_km2:
            Number(d.available_km2 ?? d.availableKm2 ?? d.available_area_km2 ?? 0) || 0,
          price_per_km2: Number(d.price_per_km2 ?? d.rate_per_km2 ?? d.pricePerKm2 ?? 0) || 0,
          monthly_price: Number(d.monthly_price ?? d.price ?? d.monthlyPrice ?? 0) || 0,
          min_monthly: Number(d.min_monthly ?? d.minimum_monthly ?? d.minMonthly ?? 0) || 0,
          coverage_pct: Number(d.coverage_pct ?? d.coverage ?? 0) || 0,
          sold_out: Boolean(d.sold_out || d.soldOut),
          reason: d.reason ?? null,
        };

        if (cancelled) return;

        setPreview(next);

        // If server returned a GeoJSON MultiPolygon, ask parent to draw it
        const gj = d.gj || d.geojson || d.multi;
        if (gj && onPreviewGeoJSON) {
          onPreviewGeoJSON(gj);
        }
      } catch (e: any) {
        if (cancelled) return;
        console.error("[AreaSponsorModal] preview error", e);
        setPreviewError(e?.message || "Preview failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [open, businessId, areaId, onPreviewGeoJSON, onClearPreview]);

  const handleBuy = async () => {
    if (!businessId || !areaId) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId,
          cleanerId: businessId,
          areaId,
          slot: 1,
        }),
      });

      if (!res.ok) {
        throw new Error(`Checkout failed (${res.status})`);
      }

      const json = await res.json();

      if (!json || json.ok === false) {
        throw new Error(json?.message || "Checkout failed");
      }

      const url: string | undefined = json.url || json.checkout_url;
      if (url) {
        window.location.href = url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (e: any) {
      console.error("[AreaSponsorModal] checkout error", e);
      setError(e?.message || "Checkout failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const soldOut = preview.sold_out || preview.available_km2 <= 0;
  const bannerText = soldOut
    ? "No purchasable area left for this slot."
    : "Featured sponsorship makes you first in local search results. Preview highlights the purchasable sub-region.";

  const bannerClass = soldOut
    ? "bg-red-50 border border-red-200 text-red-700"
    : "bg-emerald-50 border border-emerald-200 text-emerald-700";

  const areaTitle = areaName || "Service Area";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl max-w-xl w-full mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="font-semibold text-lg">Sponsor — {areaTitle}</h2>
          <button
            type="button"
            className="text-gray-500 hover:text-gray-700 text-sm"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className={`text-sm rounded-md px-3 py-2 ${bannerClass}`}>
            {bannerText}
          </div>

          {previewError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              Preview failed: {previewError}
            </div>
          )}

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="border rounded-md px-3 py-2">
              <div className="text-xs text-gray-500">Total area</div>
              <div className="font-semibold">{fmtKm2(preview.total_km2)}</div>
            </div>
            <div className="border rounded-md px-3 py-2">
              <div className="text-xs text-gray-500">Available area</div>
              <div className="font-semibold">{fmtKm2(preview.available_km2)}</div>
            </div>

            <div className="border rounded-md px-3 py-2">
              <div className="text-xs text-gray-500">Price per km² / month</div>
              <div className="font-semibold">{fmtMoney(preview.price_per_km2)}</div>
              <div className="text-[11px] text-gray-400">From server</div>
            </div>
            <div className="border rounded-md px-3 py-2">
              <div className="text-xs text-gray-500">Minimum monthly</div>
              <div className="font-semibold">{fmtMoney(preview.min_monthly)}</div>
              <div className="text-[11px] text-gray-400">Floor price</div>
            </div>

            <div className="border rounded-md px-3 py-2">
              <div className="text-xs text-gray-500">Your monthly price</div>
              <div className="font-semibold">{fmtMoney(preview.monthly_price)}</div>
            </div>
            <div className="border rounded-md px-3 py-2">
              <div className="text-xs text-gray-500">Coverage</div>
              <div className="font-semibold">
                {fmtPercent(preview.coverage_pct)} of your polygon
              </div>
            </div>
          </div>

          {soldOut && (
            <div className="text-xs text-red-600">
              {preview.reason === "owned_by_other"
                ? "Another business already sponsors the purchasable region for this slot."
                : preview.reason === "no_remaining"
                ? "There is no remaining purchasable region for this slot."
                : "No purchasable area left for this slot."}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t flex items-center justify-between">
          <button
            type="button"
            className="btn text-sm"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`btn text-sm ${
              soldOut || previewError ? "opacity-50 cursor-not-allowed" : ""
            }`}
            onClick={handleBuy}
            disabled={soldOut || previewError != null || submitting || loading}
            title={soldOut ? "No purchasable area available" : "Start checkout"}
          >
            {submitting ? "Starting checkout…" : "Buy now"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AreaSponsorModal;
