// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Props = {
  // modal control
  open: boolean;
  onClose: () => void;

  // business / area identity
  businessId: string; // cleaner/business id
  areaId: string; // service area id
  areaName?: string;

  // total area (km²) – provided by caller/editor
  totalKm2?: number;

  // editor overlay hooks
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;
};

type PreviewResponse = {
  ok: boolean;
  error?: string;
  geojson?: any;
  area_km2?: number; // available km² for purchase in this slot

  // Optional pricing fields supplied by the function (major units)
  unit_price?: number; // price per km² / month, e.g. 99.99
  unit_currency?: string; // e.g. "GBP"
  min_monthly?: number; // minimum monthly price, major units
  monthly_price?: number; // server-computed monthly price (major units)

  // Pence (minor-unit) fallbacks
  unit_price_pence?: number;
  min_monthly_pence?: number;
  monthly_price_pence?: number;
};

// --- helpers ---------------------------------------------------------------

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
    // Fallback if currency code is unexpected
    return `£${amountMajor.toFixed(2)}`;
  }
}

function clamp2(n: number) {
  // keep to 2dp, clamp to 0+
  return Math.max(0, Math.round(n * 100) / 100);
}

// --- component -------------------------------------------------------------

export default function AreaSponsorModal({
  open,
  onClose,
  businessId,
  areaId,
  areaName,
  totalKm2,
  onPreviewGeoJSON,
  onClearPreview,
}: Props) {
  // loading / error states
  const [previewLoading, setPreviewLoading] = useState(false);
  const [rateLoading, setRateLoading] = useState(false);
  const loading = previewLoading || rateLoading;

  const [error, setError] = useState<string | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const [checkingOut, setCheckingOut] = useState(false);

  // server data
  const [availableKm2, setAvailableKm2] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string>("GBP");

  // Optional server-provided pricing (major units)
  const [unitPrice, setUnitPrice] = useState<number | null>(null); // per km² / month
  const [minMonthly, setMinMonthly] = useState<number | null>(null);
  const [serverMonthly, setServerMonthly] = useState<number | null>(null);

  // Back-compat: rate endpoint (per km² / month)
  const [ratePerKm2, setRatePerKm2] = useState<number | null>(null);

  // Derived monthly: prefer exact server monthly, else unit*area with min floor
  const computedMonthly = useMemo(() => {
    if (serverMonthly != null) return clamp2(serverMonthly);
    if (availableKm2 == null) return null;

    const unit = unitPrice ?? ratePerKm2;
    if (unit == null) return null;

    const raw = availableKm2 * unit;
    const withMin = minMonthly != null ? Math.max(minMonthly, raw) : raw;
    return clamp2(withMin);
  }, [availableKm2, unitPrice, minMonthly, serverMonthly, ratePerKm2]);

  // --- effects: preview + pricing -----------------------------------------

  // Load purchasable preview (and optional pricing/currency from same endpoint)
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setPreviewLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId,
            cleanerId: businessId, // same id in your schema
            areaId,
            slot: 1, // single featured slot
          }),
        });

        if (!res.ok) throw new Error(`Preview failed (${res.status})`);
        const data: PreviewResponse = await res.json();
        if (!data?.ok) throw new Error(data?.error || "Preview not available");

        if (cancelled) return;

        // available km² (clamped)
        const avail =
          typeof data.area_km2 === "number" ? Math.max(0, data.area_km2) : 0;
        setAvailableKm2(avail);

        // overlay
        if (data.geojson && onPreviewGeoJSON) onPreviewGeoJSON(data.geojson);

        // currency/pricing (prefer major-unit fields; fall back to pence)
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
          setAvailableKm2(null);
          // Clear overlay on failure
          onClearPreview?.();
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // clear preview overlay when modal closes/unmounts
      onClearPreview?.();
    };
  }, [open, businessId, areaId, onPreviewGeoJSON, onClearPreview]);

  // Load rate (per km² / month) from separate endpoint (for back-compat)
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setRateLoading(true);
    setRateError(null);

    (async () => {
      try {
        const res = await fetch("/.netlify/functions/area-rate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slot: 1 }), // Featured slot
        });
        if (!res.ok) return; // silently ignore; preview pricing may be enough

        const j = await res.json();
        if (cancelled) return;

        const rate =
          typeof j?.rate === "number"
            ? j.rate
            : typeof j?.gold === "number"
            ? j.gold
            : null;

        setRatePerKm2(
          typeof rate === "number" && isFinite(rate) ? rate : null
        );
      } catch (e: any) {
        if (!cancelled) setRateError(e?.message || "Failed to load rate");
      } finally {
        if (!cancelled) setRateLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // --- actions -------------------------------------------------------------

  const close = () => {
    onClearPreview?.();
    onClose();
  };

  const startCheckout = async () => {
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
          slot: 1,
          // Send the specific purchasable area we previewed,
          // so the server prices consistently
          preview_km2: availableKm2,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || "Could not start checkout");
      }

      window.location.href = data.url; // redirect to Stripe
    } catch (e: any) {
      setCheckoutError(e?.message || "Checkout failed");
      setCheckingOut(false);
    }
  };

  if (!open) return null;

  const total = totalKm2 ?? null;
  const avail = availableKm2;
  const coveragePct =
    avail != null && total != null && total > 0
      ? Math.max(0, Math.min(100, (avail / total) * 100))
      : null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl ring-1 ring-black/5 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-lg">Sponsor — Featured</h3>
            {areaName && (
              <div className="text-xs text-gray-500 mt-0.5">
                Area:&nbsp;<span className="font-medium">{areaName}</span>
              </div>
            )}
          </div>
          <button
            className="text-sm opacity-70 hover:opacity-100"
            onClick={close}
            type="button"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Info / errors */}
          <div className="rounded-md border text-xs px-3 py-2 bg-emerald-50 border-emerald-200 text-emerald-800">
            Preview highlights only the purchasable sub-region on the map.
          </div>

          {(error || rateError || checkoutError) && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error || rateError || checkoutError}
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Stat
              label="Total area"
              value={total != null ? `${fmtKm2(total)} km²` : "—"}
            />
            <Stat
              label="Available area"
              value={
                previewLoading
                  ? "Loading…"
                  : avail != null
                  ? `${fmtKm2(avail)} km²`
                  : "—"
              }
            />
            <Stat
              label="Price per km² / month"
              value={
                (unitPrice ?? ratePerKm2) != null
                  ? formatMoney(unitPrice ?? ratePerKm2, currency)
                  : rateLoading
                  ? "Loading…"
                  : "—"
              }
              hint={unitPrice != null ? "From preview" : "From rate endpoint"}
            />
            <Stat
              label="Minimum monthly"
              value={
                minMonthly != null ? formatMoney(minMonthly, currency) : "—"
              }
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
            <Stat
              label="Coverage"
              value={
                coveragePct == null
                  ? "—"
                  : `${coveragePct.toFixed(1)}% of your polygon`
              }
            />
          </div>

          {/* Readout line */}
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 text-sm pt-2">
            <div className="text-gray-500">Area:</div>
            <div className="font-medium">{fmtKm2(avail)} km²</div>
            <div className="text-gray-500">
              Monthly:&nbsp;
              <span className="font-semibold">
                {computedMonthly != null
                  ? formatMoney(computedMonthly, currency)
                  : "—"}
              </span>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Your listing will be featured within the highlighted coverage.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
          <button
            className="btn"
            onClick={close}
            type="button"
            disabled={loading || checkingOut}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={startCheckout}
            type="button"
            disabled={
              loading ||
              checkingOut ||
              !avail ||
              avail <= 0 ||
              (computedMonthly == null && (unitPrice ?? ratePerKm2) == null)
            }
            title={
              !avail || avail <= 0
                ? "No purchasable area available"
                : "Proceed to checkout"
            }
          >
            {checkingOut ? "Redirecting…" : "Buy now"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- small presentational subcomponent -------------------------------------

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
