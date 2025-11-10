import React, { useEffect, useMemo, useState } from "react";

export type AreaSponsorModalProps = {
  // modal control
  open: boolean;
  onClose: () => void;

  // business / area identity
  businessId: string; // cleaner/business id
  areaId: string; // service area id
  areaName?: string;

  // Optional slot from the caller (number enum or string like "gold")
  slot?: number | string | null;

  // total area (km²) – provided by caller/editor
  totalKm2?: number;

  // editor overlay hooks
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;

  // Accept any future/unknown props to avoid type friction across files
  [key: string]: unknown;
};

type PreviewResponse = {
  ok: boolean;
  error?: string;
  geojson?: any;
  area_km2?: number; // available km² for purchase (this slot)
  // Optional pricing fields (major units)
  unit_price?: number; // per km² / month
  unit_currency?: string; // e.g. "GBP"
  min_monthly?: number;
  monthly_price?: number;
  // Pence fallbacks
  unit_price_pence?: number;
  min_monthly_pence?: number;
  monthly_price_pence?: number;
};

// helpers
const fmtKm2 = (n: number | null | undefined) =>
  Number.isFinite(n as number) ? (n as number).toFixed(3) : "—";

function formatMoney(amountMajor?: number | null, currency = "GBP") {
  if (amountMajor == null || !isFinite(amountMajor)) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountMajor);
  } catch {
    return `£${amountMajor.toFixed(2)}`;
  }
}

function clamp2(n: number) {
  return Math.max(0, Math.round(n * 100) / 100);
}

function AreaSponsorModal({
  open,
  onClose,
  businessId,
  areaId,
  areaName,
  totalKm2,
  slot,
  onPreviewGeoJSON,
  onClearPreview,
}: AreaSponsorModalProps) {
  const slotParam = slot ?? 1; // default to single-slot model if not provided

  // loading / error states
  const [previewLoading, setPreviewLoading] = useState(false);
  const [rateLoading, setRateLoading] = useState(false);
  const loading = previewLoading || rateLoading;

  const [error, setError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  // server data
  const [availableKm2, setAvailableKm2] = useState<number | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [currency, setCurrency] = useState<string>("GBP");

  // pricing
  const [unitPrice, setUnitPrice] = useState<number | null>(null); // per km² / month
  const [minMonthly, setMinMonthly] = useState<number | null>(null);
  const [serverMonthly, setServerMonthly] = useState<number | null>(null);
  const [ratePerKm2, setRatePerKm2] = useState<number | null>(null); // from optional /area-rate

  const effectiveUnit = unitPrice ?? ratePerKm2;

  const computedMonthly = useMemo(() => {
    if (serverMonthly != null) return clamp2(serverMonthly);
    if (availableKm2 == null || effectiveUnit == null) return null;
    const raw = availableKm2 * effectiveUnit;
    const withMin = minMonthly != null ? Math.max(minMonthly, raw) : raw;
    return clamp2(withMin);
  }, [availableKm2, effectiveUnit, minMonthly, serverMonthly]);

  const coveragePct = useMemo(() => {
    if (availableKm2 == null || totalKm2 == null || totalKm2 === 0) return null;
    return Math.max(0, Math.min(100, (availableKm2 / totalKm2) * 100));
  }, [availableKm2, totalKm2]);

  // Load preview (and pricing if provided by same function)
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setPreviewLoading(true);
    setError(null);
    setPreviewLoaded(false);

    (async () => {
      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId,
            cleanerId: businessId,
            areaId,
            slot: slotParam,
          }),
        });

        if (!res.ok) throw new Error(`Preview failed (${res.status})`);
        const data: PreviewResponse = await res.json();
        if (!data?.ok) throw new Error(data?.error || "Preview not available");
        if (cancelled) return;

        const avail =
          typeof data.area_km2 === "number" ? Math.max(0, data.area_km2) : 0;
        setAvailableKm2(avail);
        setPreviewLoaded(true);

        if (data.geojson && onPreviewGeoJSON) onPreviewGeoJSON(data.geojson);

        // pricing from preview (prefer major units, fall back to pence)
        const unit =
          typeof data.unit_price === "number"
            ? data.unit_price
            : typeof data.unit_price_pence === "number"
            ? data.unit_price_pence / 100
            : null;

        const minm =
          typeof data.min_monthly === "number"
            ? data.min_monthly
            : typeof data.min_monthly_pence === "number"
            ? data.min_monthly_pence / 100
            : null;

        const monthly =
          typeof data.monthly_price === "number"
            ? data.monthly_price
            : typeof data.monthly_price_pence === "number"
            ? data.monthly_price_pence / 100
            : null;

        setUnitPrice(unit);
        setMinMonthly(minm);
        setServerMonthly(monthly);
        setCurrency(data.unit_currency || "GBP");
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Preview error");
          setPreviewLoaded(true);
          setAvailableKm2(null);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      onClearPreview?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, businessId, areaId, slotParam]); // don't depend on callback identities

  // Optional: load rate from separate endpoint
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setRateLoading(true);

    (async () => {
      try {
        const res = await fetch("/.netlify/functions/area-rate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slot: slotParam }),
        });
        if (!res.ok) return; // preview pricing may be enough

        const j: any = await res.json();
        if (cancelled) return;

        const rate =
          typeof j?.rate === "number"
            ? j.rate
            : typeof j?.gold === "number"
            ? j.gold
            : null;

        if (typeof rate === "number") setRatePerKm2(rate);
        if (typeof j?.currency === "string") setCurrency(j.currency || "GBP");

        if (typeof j?.unit_price === "number") setUnitPrice(j.unit_price);
        if (typeof j?.min_monthly === "number") setMinMonthly(j.min_monthly);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setRateLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, slotParam]);

  const close = () => {
    onClearPreview?.();
    onClose();
  };

  async function startCheckout() {
    setCheckingOut(true);
    setCheckoutError(null);
    setError(null);
    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId,
          cleanerId: businessId,
          areaId,
          slot: slotParam,
          preview_km2: availableKm2,
        }),
      });

      const data: any = await res.json();
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || "Could not start checkout");
      }
      window.location.href = data.url;
    } catch (e: any) {
      setCheckoutError(e?.message || "Checkout failed");
      setCheckingOut(false);
    }
  }

  if (!open) return null;

  const hasNoPurchasableArea =
    previewLoaded && availableKm2 != null && availableKm2 <= 0;
  const canCheckout =
    !loading && !checkingOut && availableKm2 != null && availableKm2 > 0;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl ring-1 ring-black/5 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-lg">
            Sponsor {areaName ? `— ${areaName}` : "this Area"}
          </h3>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={close}>
            Close
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div className="rounded-md border text-xs px-3 py-2 bg-emerald-50 border-emerald-200 text-emerald-800">
            Preview shows only the purchasable sub‑region on the map.
          </div>

          {hasNoPurchasableArea && (
            <div className="rounded-md border text-xs px-3 py-2 bg-yellow-50 border-yellow-200 text-yellow-800">
              This slot isn’t available to purchase for this area right now.
            </div>
          )}

          {(error || checkoutError) && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error || checkoutError}
            </div>
          )}

          <div className="text-sm font-medium">Monthly price</div>
          <div className="text-xs text-gray-600">
            Rate:{" "}
            {rateLoading
              ? "…"
              : effectiveUnit != null
              ? `${formatMoney(effectiveUnit, currency)} / km² / month`
              : "—"}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Stat
              label="Total area"
              value={totalKm2 != null ? `${fmtKm2(totalKm2)} km²` : "—"}
            />
            <Stat
              label="Available area"
              value={
                loading
                  ? "Loading…"
                  : availableKm2 != null
                  ? `${fmtKm2(availableKm2)} km²`
                  : "—"
              }
            />
            <Stat
              label="Price per km² / month"
              value={
                effectiveUnit != null ? formatMoney(effectiveUnit, currency) : "—"
              }
              hint={unitPrice != null ? "From server env" : undefined}
            />
            <Stat
              label="Minimum monthly"
              value={minMonthly != null ? formatMoney(minMonthly, currency) : "—"}
              hint="Floor price"
            />
            <Stat
              label="Your monthly price"
              value={
                loading
                  ? "Loading…"
                  : computedMonthly != null
                  ? formatMoney(computedMonthly, currency)
                  : "—"
              }
              emphasis
            />
            {coveragePct != null && (
              <Stat label="Coverage" value={`${coveragePct.toFixed(1)}% of your polygon`} />
            )}
            <Stat
              label="Availability"
              value={
                previewLoaded
                  ? hasNoPurchasableArea
                    ? "Not available"
                    : "Available"
                  : "Checking…"
              }
            />
          </div>

          <p className="text-xs text-gray-500">
            Your listing will be featured within the highlighted coverage.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
          <button className="btn" onClick={close} disabled={loading || checkingOut}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={startCheckout}
            disabled={!canCheckout}
            title={!canCheckout ? "No purchasable area available" : "Proceed to checkout"}
          >
            {checkingOut ? "Redirecting…" : "Buy now"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={"mt-1 " + (emphasis ? "text-xl font-semibold" : "text-base font-medium")}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}

// Export both ways to satisfy any import style
export { AreaSponsorModal };
export type Props = AreaSponsorModalProps;
export default AreaSponsorModal;

