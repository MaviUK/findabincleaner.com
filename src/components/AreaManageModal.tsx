// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  businessId: string;
  areaId: string;
  areaName?: string;
  onPreviewGeoJSON?: (multi: any | null) => void;
  onClearPreview?: () => void;
};

type PreviewState = {
  loading: boolean;
  error: string | null;
  totalKm2: number;
  availableKm2: number;
  pricePerKm2: number;
  minMonthly: number;
  soldOut: boolean;
  coveragePct: number;
};

const initialPreviewState: PreviewState = {
  loading: false,
  error: null,
  totalKm2: 0,
  availableKm2: 0,
  pricePerKm2: 0,
  minMonthly: 0,
  soldOut: true,
  coveragePct: 0,
};

function fmtKm2(n: number) {
  if (!isFinite(n)) return "0.000 km²";
  return `${n.toFixed(3)} km²`;
}

function fmtMoney(n: number) {
  if (!isFinite(n)) return "£0.00";
  return `£${n.toFixed(2)}`;
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
  const [preview, setPreview] = useState<PreviewState>(initialPreviewState);
  const [buying, setBuying] = useState(false);
  const slot = 1; // single Featured slot

  // derived monthly price (client-side estimate; server is source of truth)
  const monthlyPrice = useMemo(() => {
    const raw = preview.availableKm2 * preview.pricePerKm2;
    if (!isFinite(raw)) return 0;
    return Math.max(raw, preview.minMonthly || 0);
  }, [preview.availableKm2, preview.pricePerKm2, preview.minMonthly]);

  useEffect(() => {
    // when modal closes, clear preview highlight
    if (!open) {
      setPreview(initialPreviewState);
      onClearPreview?.();
      return;
    }

    if (!areaId || !businessId) return;

    let cancelled = false;

    const run = async () => {
      setPreview((p) => ({ ...p, loading: true, error: null }));

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId,
            cleanerId: businessId, // back-compat
            areaId,
            slot,
          }),
        });

        if (!res.ok) {
          throw new Error(`Preview failed (${res.status})`);
        }

        const raw = await res.json();

        // --- NORMALISE SHAPE ------------------------------------------
        // We support:
        //  - { "0": { ... } }
        //  - [ { ... } ]
        //  - { ... }
        let row: any = null;

        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          if ("0" in raw && raw["0"] && typeof raw["0"] === "object") {
            row = raw["0"];
          } else if ("data" in raw && Array.isArray((raw as any).data)) {
            row = (raw as any).data[0];
          } else {
            row = raw;
          }
        } else if (Array.isArray(raw)) {
          row = raw[0];
        }

        if (!row) {
          throw new Error("Empty preview response");
        }

        const totalKm2 =
          Number(
            row.total_km2 ??
              row.totalKm2 ??
              row.total_km_2 ??
              row.total ??
              0
          ) || 0;

        const availableKm2 =
          Number(
            row.available_km2 ??
              row.availableKm2 ??
              row.available_km_2 ??
              row.available ??
              0
          ) || 0;

        const pricePerKm2 =
          Number(
            row.price_per_km2 ??
              row.rate_per_km2 ??
              row.pricePerKm2 ??
              0
          ) || 0;

        const minMonthly =
          Number(
            row.min_price_per_month ??
              row.minimum_monthly ??
              row.minPricePerMonth ??
              0
          ) || 0;

        const soldOut =
          Boolean(
            row.sold_out ??
              row.soldOut ??
              row.soldout ??
              (availableKm2 <= 0)
          );

        const coveragePct =
          totalKm2 > 0 ? (availableKm2 / totalKm2) * 100 : 0;

        if (!cancelled) {
          setPreview({
            loading: false,
            error: null,
            totalKm2,
            availableKm2,
            pricePerKm2,
            minMonthly,
            soldOut,
            coveragePct,
          });

          // send polygon/multipolygon to map overlay
          if (row.gj && onPreviewGeoJSON) {
            onPreviewGeoJSON(row.gj);
          }
        }
      } catch (e: any) {
        if (cancelled) return;
        console.error("[AreaSponsorModal] preview error", e);
        setPreview((p) => ({
          ...p,
          loading: false,
          error: e?.message || "Preview failed",
          totalKm2: 0,
          availableKm2: 0,
          pricePerKm2: 0,
          minMonthly: 0,
          soldOut: true,
          coveragePct: 0,
        }));
        onClearPreview?.();
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [open, businessId, areaId, slot, onPreviewGeoJSON, onClearPreview]);

  async function handleBuyNow() {
    if (!businessId || !areaId) return;
    setBuying(true);
    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId,
          cleanerId: businessId, // back-compat
          areaId,
          slot,
        }),
      });

      if (!res.ok) {
        throw new Error(`Checkout failed (${res.status})`);
      }

      const j = await res.json();

      // Expect either { url } or { ok, url }
      const url = j.url || (j.ok && j.url);
      if (typeof url === "string" && url.length) {
        window.location.href = url;
        return;
      }

      throw new Error(j.message || "No checkout URL returned");
    } catch (e: any) {
      console.error("[AreaSponsorModal] checkout error", e);
      alert(e?.message || "Checkout failed");
    } finally {
      setBuying(false);
    }
  }

  if (!open) return null;

  const soldOutBanner = preview.soldOut;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl max-w-xl w-full mx-4">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="font-semibold">
            Sponsor — {areaName || "Service Area"}
          </div>
          <button
            className="text-sm text-gray-500 hover:text-gray-800"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded px-3 py-2">
            Featured sponsorship makes you first in local search results.
            Preview highlights the purchasable sub-region.
          </div>

          {soldOutBanner && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2">
              No purchasable area left for this slot.
            </div>
          )}

          {preview.error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2">
              Preview failed: {preview.error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs sm:text-sm">
            <div className="border rounded-lg px-3 py-2">
              <div className="text-gray-500 mb-1">Total area</div>
              <div className="font-semibold">
                {fmtKm2(preview.totalKm2)}
              </div>
            </div>

            <div className="border rounded-lg px-3 py-2">
              <div className="text-gray-500 mb-1">Available area</div>
              <div className="font-semibold">
                {fmtKm2(preview.availableKm2)}
              </div>
            </div>

            <div className="border rounded-lg px-3 py-2">
              <div className="text-gray-500 mb-1">Price per km² / month</div>
              <div className="font-semibold">
                {fmtMoney(preview.pricePerKm2)}
              </div>
              <div className="text-[11px] text-gray-500">From server</div>
            </div>

            <div className="border rounded-lg px-3 py-2">
              <div className="text-gray-500 mb-1">Minimum monthly</div>
              <div className="font-semibold">
                {fmtMoney(preview.minMonthly)}
              </div>
              <div className="text-[11px] text-gray-500">Floor price</div>
            </div>

            <div className="border rounded-lg px-3 py-2">
              <div className="text-gray-500 mb-1">Your monthly price</div>
              <div className="font-semibold">
                {fmtMoney(monthlyPrice)}
              </div>
            </div>

            <div className="border rounded-lg px-3 py-2">
              <div className="text-gray-500 mb-1">Coverage</div>
              <div className="font-semibold">
                {preview.coveragePct.toFixed(1)}% of your polygon
              </div>
            </div>
          </div>

          {soldOutBanner && (
            <div className="text-xs text-red-600">
              No purchasable area left for this slot.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 rounded-b-xl">
          <button
            className="btn text-sm"
            onClick={onClose}
            disabled={preview.loading || buying}
          >
            Cancel
          </button>
          <button
            className="btn text-sm"
            onClick={handleBuyNow}
            disabled={
              preview.loading || buying || preview.soldOut || monthlyPrice <= 0
            }
          >
            {buying ? "Processing…" : "Buy now"}
          </button>
        </div>
      </div>
    </div>
  );
}
