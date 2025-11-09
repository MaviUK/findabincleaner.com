import React, { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;

  // business / area
  businessId: string; // cleaner/business id
  areaId: string; // service area id
  areaName?: string;

  // total area of this service area in km² – computed by the caller
  totalKm2?: number;

  // Map overlay callbacks from the editor
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;
};

type PreviewResponse = {
  ok: boolean;
  error?: string;
  geojson?: any;
  area_km2?: number; // available km² for purchase (this slot)

  // Optional pricing fields supplied by the function (if configured server-side)
  unit_price?: number; // price per km² per month, major units (e.g. 99.99)
  unit_currency?: string; // e.g., "GBP"
  min_monthly?: number; // minimum monthly price, major units
  monthly_price?: number; // server-computed monthly price (major units)

  // Back-compat: pence fields
  unit_price_pence?: number;
  min_monthly_pence?: number;
  monthly_price_pence?: number;
};

// format helpers
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
    // minimal fallback (keeps old behavior)
    return `£${amountMajor.toFixed(2)}`;
  }
}

function clamp2(n: number) {
  return Math.max(0, Math.round(n * 100) / 100);
}

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
  const [loading, setLoading] = useState(false);
  const [rateLoading, setRateLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  // preview result (what’s still purchasable)
  const [availableKm2, setAvailableKm2] = useState<number | null>(null);

  // pricing pieces
  const [currency, setCurrency] = useState<string>("GBP");
  const [ratePerKm2, setRatePerKm2] = useState<number | null>(null); // generic “rate” endpoint
  const [unitPrice, setUnitPrice] = useState<number | null>(null); // per km² per month (from preview/server env)
  const [minMonthly, setMinMonthly] = useState<number | null>(null); // minimum monthly
  const [serverMonthly, setServerMonthly] = useState<number | null>(null); // if server sent monthly

  // Derived monthly cost if server did not provide one
  const computedMonthly = useMemo(() => {
    if (serverMonthly != null) return clamp2(serverMonthly);
    if (availableKm2 == null || unitPrice == null) return null;
    const raw = availableKm2 * unitPrice;
    const minApplied = minMonthly != null ? Math.max(minMonthly, raw) : raw;
    return clamp2(minApplied);
  }, [availableKm2, unitPrice, minMonthly, serverMonthly]);

  const coveragePct = useMemo(() => {
    if (availableKm2 == null || totalKm2 == null || totalKm2 === 0) return null;
    return Math.max(0, Math.min(100, (availableKm2 / totalKm2) * 100));
  }, [availableKm2, totalKm2]);

  // Kick off preview + (optional) rate fetch when opened
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const controller = new AbortController();

    async function loadPreview() {
      setLoading(true);
      setError(null);

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
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Preview failed (${res.status})`);
        }

        const data: PreviewResponse = await res.json();
        if (cancelled) return;

        if (!data?.ok) {
          throw new Error(data?.error || "Preview not available");
        }

        // available km² (from server)
        const avail =
          typeof data.area_km2 === "number" ? Math.max(0, data.area_km2) : 0;
        setAvailableKm2(avail);

        // overlay draw
        if (data.geojson && onPreviewGeoJSON && !cancelled) {
          onPreviewGeoJSON(data.geojson);
        }

        // pricing from preview if present
        if (typeof data.unit_price === "number") setUnitPrice(data.unit_price);
        else if (typeof data.unit_price_pence === "number")
          setUnitPrice(data.unit_price_pence / 100);

        if (typeof data.min_monthly === "number")
          setMinMonthly(data.min_monthly);
        else if (typeof data.min_monthly_pence === "number")
          setMinMonthly(data.min_monthly_pence / 100);

        if (typeof data.monthly_price === "number")
          setServerMonthly(data.monthly_price);
        else if (typeof data.monthly_price_pence === "number")
          setServerMonthly(data.monthly_price_pence / 100);

        if (typeof data.unit_currency === "string")
          setCurrency(data.unit_currency || "GBP");
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Preview error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    async function loadRate() {
      setRateLoading(true);
      try {
        // This function is optional; if it doesn't exist, we still proceed using preview pricing
        const res = await fetch("/.netlify/functions/area-rate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slot: 1 }),
          signal: controller.signal,
        });

        if (res.ok) {
          const j: any = await res.json();
          if (cancelled) return;

          const rate =
            typeof j?.rate === "number"
              ? j.rate
              : typeof j?.gold === "number"
              ? j.gold
              : null;

          if (typeof rate === "number") setRatePerKm2(rate);
          if (typeof j?.currency === "string")
            setCurrency(j.currency || "GBP");

          // If your rate function also returns unit/min fields, accept them:
          if (typeof j?.unit_price === "number") setUnitPrice(j.unit_price);
          if (typeof j?.min_monthly === "number")
            setMinMonthly(j.min_monthly);
        }
      } catch {
        // swallow: rate function may not exist; preview pricing still used
      } finally {
        if (!cancelled) setRateLoading(false);
      }
    }

    loadPreview();
    loadRate();

    return () => {
      cancelled = true;
      controller.abort();
      onClearPreview?.();
    };
  }, [open, businessId, areaId, onPreviewGeoJSON, onClearPreview]);

  function close() {
    onClearPreview?.();
    onClose();
  }

  async function startCheckout() {
    setCheckingOut(true);
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
          // send the specific purchasable area we previewed, to price consistently
          preview_km2: availableKm2,
        }),
      });

      const data: any = await res.json();
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || "Could not start checkout");
      }
      window.location.href = data.url; // redirect to Stripe
    } catch (e: any) {
      setError(e?.message || "Could not start checkout.");
      setCheckingOut(false);
    }
  }

  if (!open) return null;

  const displayRate = unitPrice ?? ratePerKm2; // prefer unitPrice if preview provided it
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
          <button
            className="text-sm opacity-70 hover:opacity-100"
            onClick={close}
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div className="rounded-md border text-xs px-3 py-2 bg-emerald-50 border-emerald-200 text-emerald-800">
            Preview shows only the purchasable sub‑region on the map.
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error}
            </div>
          )}

          <div className="text-sm font-medium">Monthly price</div>
          <div className="text-xs text-gray-600">
            Rate:{" "}
            {rateLoading
              ? "…"
              : displayRate != null
              ? `${formatMoney(displayRate, currency)} / km² / month`
              : "—"}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Stat
              label="Total area"
              value={
                totalKm2 != null ? `${totalKm2.toFixed(3)} km²` : "—"
              }
            />
            <Stat
              label="Available area"
              value={
                loading
                  ? "Loading…"
                  : availableKm2 != null
                  ? `${availableKm2.toFixed(3)} km²`
                  : "—"
              }
            />
            <Stat
              label="Price per km² / month"
              value={
                displayRate != null
                  ? formatMoney(displayRate, currency)
                  : "—"
              }
              hint={unitPrice != null ? "From server env" : undefined}
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
            {coveragePct != null && (
              <Stat
                label="Coverage"
                value={`${coveragePct.toFixed(1)}% of your polygon`}
              />
            )}
          </div>

          <p className="text-xs text-gray-500">
            The map highlights the purchasable sub‑area (if any). Your listing
            will be featured in this coverage.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
          <button
            className="btn"
            onClick={close}
            disabled={loading || checkingOut}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={startCheckout}
            disabled={!canCheckout}
            title={
              !canCheckout
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
      <div
        className={"mt-1 " + (emphasis ? "text-xl font-semibold" : "text-base font-medium")}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}
