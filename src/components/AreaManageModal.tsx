// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  businessId: string;
  areaId: string;
  areaName?: string;
  onPreviewGeoJSON: (multi: any) => void;
  onClearPreview: () => void;
};

type PreviewState = {
  loading: boolean;
  error: string | null;

  totalKm2: number;
  availableKm2: number;

  pricePerKm2: number;
  floorPricePerMonth: number;
  yourPricePerMonth: number;

  coverageFraction: number; // 0..1
  soldOut: boolean;
  soldOutReason: string | null;
};

const initialState: PreviewState = {
  loading: false,
  error: null,

  totalKm2: 0,
  availableKm2: 0,

  pricePerKm2: 0,
  floorPricePerMonth: 0,
  yourPricePerMonth: 0,

  coverageFraction: 0,
  soldOut: false,
  soldOutReason: null,
};

function fmtKm2(n: number) {
  return `${n.toFixed(3)} km²`;
}

function fmtMoney(n: number) {
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
  const [state, setState] = useState<PreviewState>(initialState);

  // Reset when modal is reopened for a different area
  useEffect(() => {
    if (!open) return;
    setState(initialState);
    onClearPreview();
  }, [open, areaId, onClearPreview]);

  // --- Fetch preview from Netlify function ---
  useEffect(() => {
    if (!open || !areaId) return;

    let aborted = false;

    async function run() {
      setState((s) => ({ ...s, loading: true, error: null }));
      onClearPreview();

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
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
          throw new Error(`Preview failed (${res.status})`);
        }

        const raw: any = await res.json();
        console.log("[AreaSponsorModal] preview raw response:", raw);

        if (raw && raw.ok === false) {
          throw new Error(raw.message || "Preview failed");
        }

        // ---- Normalise shape -------------------------------------------------
        // We support all of these shapes:
        //   { ok, total_km2, ... }
        //   { ok, 0: { total_km2, ... } }
        //   { ok, data: { ... } }
        //   { ok, data: [ { ... } ] }
        //   [ { ... } ]
        let row: any = raw;

        if (Array.isArray(raw)) {
          row = raw[0];
        } else if (raw && typeof raw === "object") {
         // Our Sponsored Preview returns: { "0": { ... } }
let row: any = null;

// 1) If shape is { "0": { ... } }
if (raw && typeof raw === "object" && raw["0"]) {
  row = raw["0"];

// 2) If API ever returns an array in the future
} else if (Array.isArray(raw)) {
  row = raw[0];

// 3) Fallback
} else {
  row = raw;
}

        }

        if (!row || typeof row !== "object") {
          throw new Error("Preview: invalid response payload");
        }

        // Extract values (snake_case or camelCase)
        const totalKm2 = Number(
          row.total_km2 ?? row.totalKm2 ?? 0
        );
        const availableKm2 = Number(
          row.available_km2 ?? row.availableKm2 ?? 0
        );

        const soldOut =
          Boolean(row.sold_out ?? row.soldOut) ||
          (Number.isFinite(availableKm2) && availableKm2 <= 0);

        const soldOutReason: string | null =
          row.reason ??
          row.sold_out_reason ??
          (soldOut ? "No purchasable area left for this slot." : null);

        const pricePerKm2 = Number(
          row.price_per_km2 ?? row.pricePerKm2 ?? 0
        );
        const floorPricePerMonth = Number(
          row.min_price_per_month ?? row.minPricePerMonth ?? 0
        );
        const calcPrice = pricePerKm2 * (availableKm2 || 0);
        const yourPricePerMonth = Math.max(
          floorPricePerMonth || 0,
          Number.isFinite(calcPrice) ? calcPrice : 0
        );

        const coverageFraction =
          totalKm2 > 0 && Number.isFinite(availableKm2)
            ? availableKm2 / totalKm2
            : 0;

        const gj = row.gj ?? raw.gj ?? null;
        if (gj) {
          onPreviewGeoJSON(gj);
        }

        if (aborted) return;

        setState({
          loading: false,
          error: null,
          totalKm2: Number.isFinite(totalKm2) ? totalKm2 : 0,
          availableKm2: Number.isFinite(availableKm2) ? availableKm2 : 0,
          pricePerKm2: Number.isFinite(pricePerKm2) ? pricePerKm2 : 0,
          floorPricePerMonth: Number.isFinite(floorPricePerMonth)
            ? floorPricePerMonth
            : 0,
          yourPricePerMonth: Number.isFinite(yourPricePerMonth)
            ? yourPricePerMonth
            : 0,
          coverageFraction: coverageFraction > 0 ? coverageFraction : 0,
          soldOut,
          soldOutReason,
        });
      } catch (err: any) {
        console.error("[AreaSponsorModal] preview error:", err);
        if (aborted) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err?.message || "Preview failed",
          soldOut: false, // don’t auto-mark sold-out on error
        }));
      }
    }

    run();

    return () => {
      aborted = true;
    };
  }, [open, areaId, businessId, onPreviewGeoJSON, onClearPreview]);

  const coveragePct = useMemo(
    () => (state.coverageFraction || 0) * 100,
    [state.coverageFraction]
  );

  if (!open) return null;

  const disableBuy = state.loading || state.error !== null || state.soldOut;

  return (
    <div className="modal-backdrop">
      <div className="modal card card-pad max-w-lg w-full">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">
            Sponsor — {areaName || "Service area"}
          </h2>
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {/* Status banners */}
        {state.soldOut && (
          <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.soldOutReason || "No purchasable area left for this slot."}
          </div>
        )}

        {state.error && (
          <div className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Preview failed: {state.error}
          </div>
        )}

        {state.loading && (
          <div className="mb-2 text-xs text-gray-500">Loading preview…</div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 text-sm mt-2">
          <div className="border rounded px-3 py-2">
            <div className="text-xs text-gray-500">Total area</div>
            <div className="font-semibold">
              {fmtKm2(state.totalKm2 || 0)}
            </div>
          </div>
          <div className="border rounded px-3 py-2">
            <div className="text-xs text-gray-500">Available area</div>
            <div className="font-semibold">
              {fmtKm2(state.availableKm2 || 0)}
            </div>
          </div>

          <div className="border rounded px-3 py-2">
            <div className="text-xs text-gray-500">Price per km² / month</div>
            <div className="font-semibold">
              {fmtMoney(state.pricePerKm2 || 0)}
            </div>
            <div className="text-[10px] text-gray-500">From server</div>
          </div>
          <div className="border rounded px-3 py-2">
            <div className="text-xs text-gray-500">Minimum monthly</div>
            <div className="font-semibold">
              {fmtMoney(state.floorPricePerMonth || 0)}
            </div>
            <div className="text-[10px] text-gray-500">Floor price</div>
          </div>

          <div className="border rounded px-3 py-2">
            <div className="text-xs text-gray-500">Your monthly price</div>
            <div className="font-semibold">
              {fmtMoney(state.yourPricePerMonth || 0)}
            </div>
          </div>
          <div className="border rounded px-3 py-2">
            <div className="text-xs text-gray-500">Coverage</div>
            <div className="font-semibold">
              {coveragePct.toFixed(1)}% of your polygon
            </div>
          </div>
        </div>

        {state.soldOut && (
          <div className="mt-2 text-xs text-red-600">
            No purchasable area left for this slot.
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 flex justify-between items-center">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${disableBuy ? "opacity-50 cursor-not-allowed" : ""}`}
            disabled={disableBuy}
            onClick={() => {
              // this just closes; actual checkout is handled by the existing flow
              onClose();
            }}
          >
            Buy now
          </button>
        </div>
      </div>
    </div>
  );
}
