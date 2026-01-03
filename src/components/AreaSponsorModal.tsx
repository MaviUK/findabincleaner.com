import React, { useEffect, useMemo, useState } from "react";

type Slot = 1;

type Props = {
  open: boolean;
  onClose: () => void;

  businessId: string;
  categoryId?: string | null; // ✅ REQUIRED for per-industry sponsorship
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
  priceCents: number | null;
  ratePerKm2: number | null;
  geojson: any | null;
  reason?: string;
};

const GBP = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `£${n.toFixed(2)}` : "—";

const fmtKm2 = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(3)} km²` : "—";

const EPS = 1e-6;

export default function AreaSponsorModal({
  open,
  onClose,
  businessId,
  categoryId,
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
  });

  const monthlyPrice = useMemo(() => {
    if (pv.priceCents == null) return null;
    return pv.priceCents / 100;
  }, [pv.priceCents]);

  // ✅ Preview (per industry)
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!open) return;

      if (!categoryId) {
        const next: PreviewState = {
          loading: false,
          error: "Missing categoryId",
          soldOut: false,
          totalKm2: null,
          availableKm2: null,
          priceCents: null,
          ratePerKm2: null,
          geojson: null,
        };
        setPv(next);
        onPreviewGeoJSON?.(null);
        return;
      }

      setPv((s) => ({ ...s, loading: true, error: null }));

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ businessId, areaId, slot, categoryId }),
        });

        const j = await res.json().catch(() => null);

        if (!res.ok || !j?.ok) {
          throw new Error(j?.error || j?.message || "Preview failed");
        }

        const totalKm2 = typeof j.total_km2 === "number" ? j.total_km2 : null;
        const availableKm2 = typeof j.available_km2 === "number" ? j.available_km2 : 0;

        // ✅ only sold out if remaining is zero/none
        const soldOut =
          Boolean(j.sold_out) ||
          j.reason === "no_remaining" ||
          !Number.isFinite(availableKm2) ||
          availableKm2 <= EPS;

        const geojson = j.geojson ?? null;

        // If server says there's remaining area but geojson is missing,
        // treat as not purchasable (prevents DB mismatch / bad checkout).
        const purchasableGeojson = soldOut ? null : geojson;

        if (!cancelled) {
          setPv({
            loading: false,
            error: null,
            soldOut,
            totalKm2,
            availableKm2,
            priceCents: typeof j.price_cents === "number" ? j.price_cents : null,
            ratePerKm2: typeof j.rate_per_km2 === "number" ? j.rate_per_km2 : null,
            geojson: purchasableGeojson,
            reason: j.reason,
          });
        }

        onPreviewGeoJSON?.(purchasableGeojson);
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
          });
        }
        onPreviewGeoJSON?.(null);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [open, businessId, areaId, slot, categoryId]); // intentionally not depending on callbacks

  const handleClose = () => {
    onClearPreview?.();
    onClose();
  };

  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);

  // ✅ Must have remaining area AND a valid remaining geometry to purchase
  const hasRemainingKm2 = (pv.availableKm2 ?? 0) > EPS;
  const hasRemainingGeo = !!pv.geojson;

  const canBuy =
    open &&
    !!categoryId &&
    !checkingOut &&
    !pv.loading &&
    !pv.soldOut &&
    hasRemainingKm2 &&
    hasRemainingGeo;

  const startCheckout = async () => {
    if (!canBuy) return;

    if (!categoryId) {
      setCheckoutErr("Missing categoryId");
      return;
    }

    if (!hasRemainingKm2 || pv.soldOut || !hasRemainingGeo) {
      setCheckoutErr("No purchasable region available for this industry in this polygon.");
      setPv((s) => ({ ...s, soldOut: true, availableKm2: 0, geojson: null }));
      return;
    }

    setCheckingOut(true);
    setCheckoutErr(null);

    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId, areaId, slot, categoryId }),
      });

      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.ok) {
        const message =
          j?.message ||
          j?.error ||
          (res.status === 409
            ? "No purchasable region available for this industry in this polygon."
            : `Checkout failed (${res.status})`);

        setCheckoutErr(message);

        if (res.status === 409) {
          setPv((s) => ({ ...s, soldOut: true, availableKm2: 0, geojson: null }));
        }

        setCheckingOut(false);
        return;
      }

      const url = j.url as string;
      window.location.assign(url);
    } catch (e: any) {
      setCheckoutErr(e?.message || "Checkout failed");
      setCheckingOut(false);
    }
  };

  if (!open) return null;

  let coverageLabel = "—";
  if (pv.totalKm2 && pv.totalKm2 > EPS && pv.availableKm2 != null) {
    const pct = (pv.availableKm2 / pv.totalKm2) * 100;
    coverageLabel = `${pct.toFixed(1)}% of your polygon`;
  }

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
            Featured sponsorship makes you first in local search results. The preview highlights the purchasable sub-region
            (any overlapping sponsored parts are excluded).
          </div>

          {!categoryId && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
              Missing categoryId
            </div>
          )}

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

          {pv.soldOut && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
              This polygon has no remaining purchasable region for this industry.
            </div>
          )}

          {!pv.soldOut && hasRemainingKm2 && !hasRemainingGeo && (
            <div className="rounded-md border border-amber-200 bg-amber-50 text-amber-800 text-sm p-2">
              Remaining area exists, but the server could not return a valid purchasable geometry preview. Please try again.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total area" value={fmtKm2(pv.totalKm2)} />
            <Stat label="Available area" value={fmtKm2(pv.availableKm2)} />
            <Stat label="Price per km² / month" hint="From server" value={GBP(pv.ratePerKm2 ?? null)} />
            <Stat label="Minimum monthly" hint="Floor price" value="£1.00" />
            <Stat label="Your monthly price" value={GBP(monthlyPrice)} />
            <Stat label="Coverage" value={coverageLabel} />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button className="btn" onClick={handleClose}>
              Cancel
            </button>

            <button
              className={`btn ${canBuy ? "btn-primary" : "opacity-60 cursor-default"}`}
              onClick={startCheckout}
              disabled={!canBuy}
              title={canBuy ? "Buy now" : ""}
            >
              {checkingOut ? "Redirecting..." : "Buy now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
      {hint && <div className="text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
}
