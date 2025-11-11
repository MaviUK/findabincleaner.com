// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Slot = 1; // single featured slot

type Props = {
  open: boolean;
  onClose: () => void;

  businessId: string;       // cleaner/business id
  areaId: string;           // service area id
  slot?: Slot;              // defaults to 1 (featured)

  // Map preview hooks (optional but recommended)
  onPreviewGeoJSON?: (gj: any | null) => void;
  onClearPreview?: () => void;
};

type PreviewState = {
  loading: boolean;
  error: string | null;

  // from server
  soldOut: boolean;
  totalKm2: number | null;
  availableKm2: number | null;
  priceCents: number | null;
  ratePerKm2: number | null;
  reason?: "owned_by_other" | "no_remaining" | "ok";

  // for overlay
  geojson: any | null;
};

const GBP = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `£${n.toFixed(2)}` : "—";

const fmtKm2 = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(3)} km²` : "—";

const EPS = 1e-9;

export default function AreaSponsorModal({
  open,
  onClose,
  businessId,
  areaId,
  slot = 1,
  onPreviewGeoJSON,
  onClearPreview,
}: Props) {
  const [pv, setPv] = useState<PreviewState>({
    loading: false,
    error: null,
    soldOut: false,
    totalKm2: null,
    availableKm2: null,
    priceCents: null,
    ratePerKm2: null,
    geojson: null,
  });

  const monthlyPrice = useMemo(() => {
    if (pv.priceCents == null) return null;
    return pv.priceCents / 100;
  }, [pv.priceCents]);

  // kick off preview when modal opens
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!open) return;
      setPv((s) => ({ ...s, loading: true, error: null }));

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ businessId, areaId, slot }),
        });

        const j = await res.json();

        if (!res.ok || !j?.ok) {
          const msg =
            j?.error ||
            (typeof j?.message === "string" ? j.message : "Preview failed");
          throw new Error(msg);
        }

        const totalKm2 =
          typeof j.total_km2 === "number" && isFinite(j.total_km2)
            ? j.total_km2
            : null;

        const availableKm2 =
          j.sold_out ? 0 : (typeof j.available_km2 === "number" ? j.available_km2 : 0);

        if (!cancelled) {
          setPv({
            loading: false,
            error: null,
            soldOut: !!j.sold_out || (availableKm2 ?? 0) <= EPS,
            totalKm2,
            availableKm2,
            priceCents: typeof j.price_cents === "number" ? j.price_cents : null,
            ratePerKm2:
              typeof j.rate_per_km2 === "number" ? j.rate_per_km2 : null,
            geojson: j.geojson ?? null,
            reason: j.reason,
          });
        }

        // map overlay preview
        if (onPreviewGeoJSON) onPreviewGeoJSON(j.geojson ?? null);
      } catch (e: any) {
        if (!cancelled) {
          setPv((s) => ({
            ...s,
            loading: false,
            error: e?.message || "Preview failed",
            soldOut: false,
            totalKm2: null,
            availableKm2: null,
            priceCents: null,
            ratePerKm2: null,
            geojson: null,
          }));
        }
        if (onPreviewGeoJSON) onPreviewGeoJSON(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, businessId, areaId, slot]);

  // clear preview overlay when closing
  const handleClose = () => {
    if (onClearPreview) onClearPreview();
    onClose();
  };

  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);

  const canBuy =
    open &&
    !pv.loading &&
    !pv.soldOut &&
    (pv.availableKm2 ?? 0) > EPS &&
    !checkingOut;

  const startCheckout = async () => {
    if (!canBuy) return;
    setCheckingOut(true);
    setCheckoutErr(null);

    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId, areaId, slot }),
      });

      const j = await res.json();

      if (!res.ok || !j?.ok) {
        // 409s (conflict) get shown inline as a friendly banner
        const message =
          j?.message ||
          j?.error ||
          (res.status === 409
            ? "No purchasable area left for this slot."
            : "Checkout failed");
        setCheckoutErr(message);

        // If the server says it's sold out now, reflect immediately
        if (res.status === 409) {
          setPv((s) => ({ ...s, soldOut: true, availableKm2: 0 }));
        }
        setCheckingOut(false);
        return;
      }

      const url = j.url as string | undefined;
      if (url) {
        window.location.assign(url);
      } else {
        setCheckoutErr("Checkout session missing redirect URL.");
        setCheckingOut(false);
      }
    } catch (e: any) {
      setCheckoutErr(e?.message || "Checkout failed");
      setCheckingOut(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
      <div className="bg-white w-[640px] max-w-[92vw] rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Sponsor — {/* area name removed intentionally */}</div>
          <button className="btn" onClick={handleClose}>Close</button>
        </div>

        <div className="p-4 space-y-3">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm p-2">
            Featured sponsorship makes you first in local search results. Preview highlights the purchasable sub-region.
          </div>

          {/* Error banners */}
          {pv.error && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
              {pv.error}
            </div>
          )}
          {pv.soldOut && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
              No purchasable area left for this slot.
            </div>
          )}
          {checkoutErr && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
              {checkoutErr}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total area" value={fmtKm2(pv.totalKm2)} />
            <Stat label="Available area" value={fmtKm2(pv.availableKm2)} />
            <Stat
              label="Price per km² / month"
              hint="From server"
              value={GBP(pv.ratePerKm2 ?? null)}
            />
            <Stat label="Minimum monthly" hint="Floor price" value="£1.00" />
            <Stat
              label="Your monthly price"
              value={GBP(monthlyPrice)}
            />
            <Stat label="Coverage" value="100.0% of your polygon" />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button className="btn" onClick={handleClose}>Cancel</button>
            <button
              className={`btn ${canBuy ? "btn-primary" : "opacity-60 cursor-not-allowed"}`}
              onClick={startCheckout}
              disabled={!canBuy}
              title={!canBuy ? "No purchasable area available" : "Buy now"}
            >
              {checkingOut ? "Redirecting..." : "Buy now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small stat card used in the modal */
function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
      {hint && <div className="text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
}
