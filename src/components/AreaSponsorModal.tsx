import React, { useEffect, useMemo, useState } from "react";

type Slot = 1;

type Props = {
  open: boolean;
  onClose: () => void;

  cleanerId: string; // caller passes cleanerId
  areaId: string;
  slot?: Slot;

  areaName?: string;

  onPreviewGeoJSON?: (gj: any | null) => void;
  onClearPreview?: () => void;
};

type PreviewState = {
  loading: boolean;
  error: string | null;
  soldOut: boolean;
  totalKm2: number | null;
  availableKm2: number | null;
  priceCents: number | null; // new monthly price (after expansion or first purchase)
  ratePerKm2: number | null;
  geojson: any | null;
  reason?: string;
  hasExisting: boolean; // whether this cleaner already has a sponsorship for this area+slot
};

const GBP = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `£${n.toFixed(2)}` : "—";

const fmtKm2 = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(3)} km²` : "—";

const EPS = 1e-9;

export default function AreaSponsorModal({
  open,
  onClose,
  cleanerId,
  areaId,
  slot = 1,
  areaName,
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
    hasExisting: false,
  });

  const monthlyPrice = useMemo(() => {
    if (pv.priceCents == null) return null;
    return pv.priceCents / 100;
  }, [pv.priceCents]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!open) return;

      setPv((s) => ({ ...s, loading: true, error: null }));

      try {
        // Use the new upgrade-preview endpoint for both new + existing sponsors
        const res = await fetch("/.netlify/functions/sponsored-upgrade-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId: cleanerId, // backend accepts businessId or cleanerId
            areaId,
            slot,
          }),
        });

        const j = await res.json();

        if (!res.ok || !j?.ok) {
          throw new Error(j?.error || j?.message || "Preview failed");
        }

        const totalKm2 = typeof j.total_km2 === "number" ? j.total_km2 : null;

        const availableKm2 =
          typeof j.available_km2 === "number" ? j.available_km2 : 0;

        const newPriceCents =
          typeof j.new_price_cents === "number" ? j.new_price_cents : null;

        // Approximate rate per km² if we have new_total_area_km2 + new_price_cents
        let ratePerKm2: number | null = null;
        if (
          typeof j.new_total_area_km2 === "number" &&
          j.new_total_area_km2 > EPS &&
          typeof newPriceCents === "number"
        ) {
          ratePerKm2 = (newPriceCents / 100) / j.new_total_area_km2;
        }

        if (!cancelled) {
          const soldOut = j.sold_out === true || (availableKm2 ?? 0) <= EPS;

          setPv({
            loading: false,
            error: null,
            soldOut,
            totalKm2,
            availableKm2,
            priceCents: newPriceCents,
            ratePerKm2,
            geojson: j.geojson ?? null,
            reason: j.reason,
            hasExisting: !!j.has_existing,
          });
        }

        onPreviewGeoJSON?.(j.geojson ?? null);
      } catch (e: any) {
        if (!cancelled) {
          setPv({
            loading: false,
            error: e?.message || "Preview failed",
            soldOut: false,
            totalKm2: null,
            availableKm2: null,
            priceCents: null,
            ratePerKm2: null,
            geojson: null,
            reason: undefined,
            hasExisting: false,
          });
        }
        onPreviewGeoJSON?.(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [open, cleanerId, areaId, slot, onPreviewGeoJSON]);

  const handleClose = () => {
    onClearPreview?.();
    onClose();
  };

  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);

  const hasArea = (pv.availableKm2 ?? 0) > EPS;

  // Can buy/upgrade if we have some area and we're not currently busy
  const canBuy = open && hasArea && !checkingOut;

  const startCheckout = async () => {
    if (!canBuy) return;
    setCheckingOut(true);
    setCheckoutErr(null);

    try {
      const endpoint = pv.hasExisting
        ? "/.netlify/functions/sponsored-upgrade"
        : "/.netlify/functions/sponsored-checkout";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId: cleanerId, // backend deals with mapping to cleaners table
          areaId,
          slot,
        }),
      });

      const j = await res.json();

      if (!res.ok || !j?.ok) {
        const message =
          j?.message ||
          j?.error ||
          (res.status === 409
            ? "No purchasable area left for this slot."
            : pv.hasExisting
            ? "Upgrade failed"
            : "Checkout failed");

        setCheckoutErr(message);

        if (res.status === 409) {
          setPv((s) => ({ ...s, soldOut: true, availableKm2: 0 }));
        }

        setCheckingOut(false);
        return;
      }

      if (!pv.hasExisting) {
        // First-time sponsorship → Stripe Checkout redirect
        const url = j.url as string | undefined;
        if (url) {
          window.location.assign(url);
          return;
        }
        setCheckoutErr("Checkout session missing redirect URL.");
        setCheckingOut(false);
        return;
      }

      // Upgrade: no redirect – subscription updated server-side for next billing period
      setCheckoutErr(null);
      setCheckingOut(false);
      onClose();
    } catch (e: any) {
      setCheckoutErr(
        e?.message || (pv.hasExisting ? "Upgrade failed" : "Checkout failed")
      );
      setCheckingOut(false);
    }
  };

  if (!open) return null;

  // Coverage label & hint:
  // - For NEW sponsorship: "X% of your polygon" = portion you'll sponsor
  // - For UPGRADE: "X% extra of your polygon" = additional coverage available
  let coverageLabel = "—";
  let coverageHint: string | undefined;

  if (pv.totalKm2 && pv.totalKm2 > EPS && pv.availableKm2 != null) {
    const pct = (pv.availableKm2 / pv.totalKm2) * 100;
    if (pv.hasExisting) {
      coverageLabel = `${pct.toFixed(1)}% extra of your polygon`;
      coverageHint = "Additional coverage you can still sponsor";
    } else {
      coverageLabel = `${pct.toFixed(1)}% of your polygon`;
      coverageHint = "Portion of this area you'll sponsor";
    }
  }

  const actionLabel = pv.hasExisting ? "Confirm upgrade" : "Buy now";
  const loadingLabel = pv.hasExisting ? "Updating..." : "Redirecting...";
  const priceLabel = pv.hasExisting ? "Your new monthly price" : "Your monthly price";

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
      <div className="bg-white w-[640px] max-w-[92vw] rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Sponsor — {areaName || "Area"}</div>
          <button className="btn" onClick={handleClose}>
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm p-2">
            Featured sponsorship makes you first in local search results. Preview highlights the
            purchasable sub-region.
          </div>

          {pv.error && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
              {pv.error}
            </div>
          )}

          {checkoutErr && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
              {checkoutErr}
            </div>
          )}

          {pv.soldOut && !hasArea && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
              No purchasable area left for this slot.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total area" value={fmtKm2(pv.totalKm2)} />
            <Stat label="Available area" value={fmtKm2(pv.availableKm2)} />
            <Stat
              label="Price per km² / month"
              hint="Approximate from preview"
              value={GBP(pv.ratePerKm2 ?? null)}
            />
            <Stat label="Minimum monthly" hint="Floor price" value="£1.00" />
            <Stat
              label={priceLabel}
              hint={pv.hasExisting ? "After expansion (next billing period)" : undefined}
              value={GBP(monthlyPrice)}
            />
            <Stat label="Coverage" value={coverageLabel} hint={coverageHint} />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button className="btn" onClick={handleClose}>
              Cancel
            </button>
            <button
              className={`btn ${canBuy ? "btn-primary" : "opacity-60 cursor-not-allowed"}`}
              onClick={startCheckout}
              disabled={!canBuy}
              title={!canBuy ? "No purchasable area available" : actionLabel}
            >
              {checkingOut ? loadingLabel : actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
