// src/components/AreaSponsorModal.tsx
import React, { useEffect, useState } from "react";

type PreviewReason =
  | "ok"
  | "no_remaining"
  | "owned_by_other"
  | "area_not_found"
  | string;

interface PreviewResponse {
  total_km2: number;
  available_km2: number;
  sold_out: boolean;
  reason: PreviewReason;
  gj?: any;
}

interface Props {
  open: boolean;
  onClose: () => void;

  // Caller can pass either businessId (old) or cleanerId (new).
  businessId?: string;
  cleanerId?: string;

  areaId: string;
  slot?: number;

  // Extra props that ServiceAreaEditor already passes
  areaName?: string;
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;
}

const reasonMessages: Record<PreviewReason, string> = {
  ok: "",
  no_remaining: "No purchasable area left for this slot.",
  owned_by_other: "This slot is already sponsored by another business.",
  area_not_found: "We couldn’t find this service area.",
};

function formatKm2(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return "—";
  return `${(value ?? 0).toFixed(3)} km²`;
}

const AreaSponsorModal: React.FC<Props> = ({
  open,
  onClose,
  businessId,
  cleanerId,
  areaId,
  slot,
  areaName,
  onPreviewGeoJSON,
  onClearPreview,
}) => {
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Let either ID work
  const effectiveBusinessId = businessId ?? cleanerId ?? "";

  // Fetch preview whenever the modal opens / area / slot changes
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);

    // If caller wants to clear any existing highlight, do it up front
    if (onClearPreview) onClearPreview();

    (async () => {
      try {
        const res = await fetch("/api/sponsored/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ areaId, slot }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || "Preview failed");
        }

        const data = (await res.json()) as PreviewResponse;
        if (cancelled) return;

        setPreview(data);

        // Pass highlighted GeoJSON back to map if caller wants it
        if (onPreviewGeoJSON && data.gj && data.reason === "ok") {
          onPreviewGeoJSON(data.gj);
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error("Preview error", err);
        setPreviewError(err.message || "Preview failed");
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, areaId, slot, onPreviewGeoJSON, onClearPreview]);

  // Clear highlight when the modal closes
  useEffect(() => {
    if (!open && onClearPreview) {
      onClearPreview();
    }
  }, [open, onClearPreview]);

  if (!open) return null;

  const totalKm2 = preview?.total_km2 ?? null;
  const availableKm2 = preview?.available_km2 ?? null;
  const soldOutFlag = preview?.sold_out ?? false;
  const reason: PreviewReason = preview?.reason ?? "ok";

  const hasNoArea =
    soldOutFlag ||
    (availableKm2 !== null && availableKm2 <= 0) ||
    reason === "no_remaining";

  const canBuy =
    !loadingPreview &&
    !hasNoArea &&
    !previewError &&
    !!effectiveBusinessId &&
    availableKm2 !== null &&
    availableKm2 > 0;

  const topError =
    previewError ||
    (reason !== "ok" && reasonMessages[reason]) ||
    (hasNoArea ? "No purchasable area left for this slot." : null);

  // Temporary rate (you can still wire this to /api/area-rate if you like)
  const pricePerKm2 = 1; // £1 per km² / month
  const monthlyPrice =
    availableKm2 && Number.isFinite(availableKm2)
      ? availableKm2 * pricePerKm2
      : 0;

  const handleBuyNow = async () => {
    if (!canBuy) return;

    if (!effectiveBusinessId) {
      setCheckoutError("Missing business ID. Please sign in again.");
      return;
    }

    setCheckoutError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/sponsored/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          areaId,
          slot,
          businessId: effectiveBusinessId,
        }),
      });

      if (!res.ok) {
        if (res.status === 409) {
          setCheckoutError(
            "This slot has just been taken by another business.",
          );
          return;
        }

        const text = await res.text();
        throw new Error(text || "Checkout failed");
      }

      const json = await res.json();
      if (json && json.url) {
        window.location.href = json.url;
      } else {
        setCheckoutError("Unexpected response from checkout.");
      }
    } catch (err: any) {
      console.error("Checkout error", err);
      setCheckoutError(err.message || "Checkout failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-xl rounded-lg bg-white shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold">
            Sponsor — {areaName || "Area"}
          </h2>
          <button
            type="button"
            className="text-sm text-gray-500 hover:text-gray-700"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {/* Info banner */}
        <div className="border-b bg-green-50 px-6 py-3 text-sm text-green-800">
          Featured sponsorship makes you first in local search results. Preview
          highlights the purchasable sub-region.
        </div>

        {/* Error / reason banner */}
        {topError && (
          <div className="border-b bg-red-50 px-6 py-3 text-sm text-red-700">
            {topError || "Preview failed"}
          </div>
        )}

        {/* Body */}
        <div className="grid gap-4 px-6 py-5 sm:grid-cols-2">
          {/* Total area */}
          <div className="rounded border px-4 py-3">
            <div className="text-xs uppercase text-gray-500">Total area</div>
            <div className="mt-1 text-lg font-semibold">
              {loadingPreview ? "Loading…" : formatKm2(totalKm2)}
            </div>
          </div>

          {/* Available area */}
          <div className="rounded border px-4 py-3">
            <div className="text-xs uppercase text-gray-500">
              Available area
            </div>
            <div className="mt-1 text-lg font-semibold text-gray-900">
              {loadingPreview ? "Loading…" : formatKm2(availableKm2)}
            </div>
          </div>

          {/* Price per km² / month */}
          <div className="rounded border px-4 py-3">
            <div className="text-xs uppercase text-gray-500">
              Price per km² / month
            </div>
            <div className="mt-1 text-lg font-semibold">
              £{pricePerKm2.toFixed(2)}
            </div>
            <div className="mt-1 text-xs text-gray-400">From server</div>
          </div>

          {/* Minimum monthly */}
          <div className="rounded border px-4 py-3">
            <div className="text-xs uppercase text-gray-500">
              Minimum monthly
            </div>
            <div className="mt-1 text-lg font-semibold">£1.00</div>
            <div className="mt-1 text-xs text-gray-400">Floor price</div>
          </div>

          {/* Your monthly price */}
          <div className="rounded border px-4 py-3">
            <div className="text-xs uppercase text-gray-500">
              Your monthly price
            </div>
            <div className="mt-1 text-lg font-semibold">
              {loadingPreview ? "—" : `£${monthlyPrice.toFixed(2)}`}
            </div>
          </div>

          {/* Coverage */}
          <div className="rounded border px-4 py-3">
            <div className="text-xs uppercase text-gray-500">Coverage</div>
            <div className="mt-1 text-lg font-semibold">
              {loadingPreview || !preview
                ? "—"
                : hasNoArea
                ? "0.0% of your polygon"
                : "100.0% of your polygon"}
            </div>
          </div>
        </div>

        {/* Checkout error */}
        {checkoutError && (
          <div className="px-6 pb-2 text-sm text-red-600">
            {checkoutError}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          <button
            type="button"
            className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleBuyNow}
            disabled={!canBuy || submitting}
            className={`rounded px-4 py-2 text-sm font-semibold text-white ${
              !canBuy || submitting
                ? "cursor-not-allowed bg-gray-400"
                : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {submitting ? "Processing…" : "Buy now"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AreaSponsorModal;
