import React, { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;

  businessId: string;         // cleaner/business id
  areaId: string;             // service area id

  // Map overlay callbacks from the editor
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;

  // Total area of the selected service area (km²) – computed by the caller
  totalKm2?: number;
};

type PreviewResponse = {
  ok: boolean;
  error?: string;
  geojson?: any;
  area_km2?: number; // available km² for purchase (this slot)
  // Optional pricing fields supplied by the function (if configured server-side)
  unit_price?: number;            // price per km² per month, in major units (e.g., 99.99)
  unit_currency?: string;         // e.g. "GBP"
  min_monthly?: number;           // minimum monthly price, major units
  monthly_price?: number;         // server-computed monthly price (major units)
  // Backward-compat: support pence forms if your function returns them
  unit_price_pence?: number;      // integer pence
  min_monthly_pence?: number;     // integer pence
  monthly_price_pence?: number;   // integer pence
};

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

export default function AreaSponsorModal({
  open,
  onClose,
  businessId,
  areaId,
  onPreviewGeoJSON,
  onClearPreview,
  totalKm2,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [availableKm2, setAvailableKm2] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string>("GBP");

  // Pricing (major units)
  const [unitPrice, setUnitPrice] = useState<number | null>(null);     // per km² per month
  const [minMonthly, setMinMonthly] = useState<number | null>(null);   // minimum monthly
  const [serverMonthly, setServerMonthly] = useState<number | null>(null); // if server sent monthly

  // Derived monthly cost if server did not provide
  const computedMonthly = useMemo(() => {
    if (serverMonthly != null) return clamp2(serverMonthly);
    if (availableKm2 == null || unitPrice == null) return null;
    const raw = availableKm2 * unitPrice;
    const minApplied = minMonthly != null ? Math.max(minMonthly, raw) : raw;
    return clamp2(minApplied);
  }, [availableKm2, unitPrice, minMonthly, serverMonthly]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadPreview() {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId,
            cleanerId: businessId, // same id in your schema
            areaId,
            slot: 1, // single-slot model
          }),
        });

        if (!res.ok) {
          throw new Error(`Preview failed (${res.status})`);
        }

        const data: PreviewResponse = await res.json();
        if (!data?.ok) {
          throw new Error(data?.error || "Preview not available");
        }

        if (cancelled) return;

        // overlay
        if (data.geojson && onPreviewGeoJSON) onPreviewGeoJSON(data.geojson);

        // available km² (from server)
        const avail = typeof data.area_km2 === "number" ? Math.max(0, data.area_km2) : 0;
        setAvailableKm2(avail);

        // currency
        setCurrency(data.unit_currency || "GBP");

        // pricing
        // Prefer server-provided major-unit fields. Fall back to pence if supplied.
        const unit =
          (typeof data.unit_price === "number" ? data.unit_price : null) ??
          (typeof data.unit_price_pence === "number" ? data.unit_price_pence / 100 : null);

        const minm =
          (typeof data.min_monthly === "number" ? data.min_monthly : null) ??
          (typeof data.min_monthly_pence === "number" ? data.min_monthly_pence / 100 : null);

        const monthly =
          (typeof data.monthly_price === "number" ? data.monthly_price : null) ??
          (typeof data.monthly_price_pence === "number" ? data.monthly_price_pence / 100 : null);

        setUnitPrice(unit);
        setMinMonthly(minm);
        setServerMonthly(monthly);
      } catch (e: any) {
        if (!cancelled) {
          setErr(e?.message || "Failed to load preview");
          setAvailableKm2(null);
          setUnitPrice(null);
          setMinMonthly(null);
          setServerMonthly(null);
          if (onClearPreview) onClearPreview();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, businessId, areaId]);

  function close() {
    if (onClearPreview) onClearPreview();
    onClose();
  }

  async function startCheckout() {
    setCheckingOut(true);
    setErr(null);
    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId,
          cleanerId: businessId,
          areaId,
          slot: 1, // single-slot world
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) throw new Error(data?.error || "Could not start checkout");
      window.location.href = data.url; // redirect to Stripe
    } catch (e: any) {
      setErr(e?.message || "Checkout failed");
      setCheckingOut(false);
    }
  }

  if (!open) return null;

  const total = totalKm2 ?? null;
  const avail = availableKm2;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl ring-1 ring-black/5 overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-lg">Sponsor this Area</h3>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={close}>
            Close
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Stat label="Total area" value={total != null ? `${total.toFixed(3)} km²` : "—"} />
            <Stat
              label="Available area"
              value={
                loading
                  ? "Loading…"
                  : avail != null
                  ? `${avail.toFixed(3)} km²`
                  : "—"
              }
            />
            <Stat
              label="Price per km² / month"
              value={unitPrice != null ? formatMoney(unitPrice, currency) : "—"}
              hint="From server env"
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
          </div>

          <p className="text-xs text-gray-500">
            The map highlights the purchasable sub-area (if any). Your listing will be featured in
            this coverage.
          </p>
        </div>

        <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
          <button className="btn" onClick={close} disabled={loading || checkingOut}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={startCheckout}
            disabled={loading || checkingOut || !avail || avail <= 0}
            title={!avail || avail <= 0 ? "No purchasable area available" : "Proceed to checkout"}
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
