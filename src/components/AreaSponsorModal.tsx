// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

/**
 * AreaSponsorModal
 * - Single Featured slot
 * - Fetches preview (available sub-geometry + areas + pricing hints) from
 *   `/.netlify/functions/sponsored-preview`
 * - Computes monthly price with safe fallbacks (so UI never blocks for missing envs)
 */

type Props = {
  open: boolean;
  onClose: () => void;

  // business/area
  businessId: string;     // cleaner/business id
  areaId: string;         // service area id
  areaName?: string;

  // Map overlay callbacks from the editor
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;

  // Optional: total area (km²) if the caller already knows it;
  // if not provided, we try to read total from preview response.
  totalKm2?: number;
};

// --- helpers ---
const clamp2 = (n: number) => Math.max(0, Math.round(n * 100) / 100);

const formatMoney = (amountMajor?: number | null, currency = "GBP") => {
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
};

const fmtKm2 = (n: number | null | undefined) =>
  Number.isFinite(n as number) ? `${(n as number).toFixed(3)} km²` : "—";

// ---- preview payload (union of old/new fields for backwards-compat) ----
type PreviewResponse = {
  ok: boolean;
  error?: string;

  // geometry + areas
  geojson?: any;
  area_km2?: number | null;   // purchasable area left for this slot
  total_km2?: number | null;  // total area of the saved service area (optional)

  // pricing (various server versions supported)
  // new-style
  rate_per_km2?: number | null;       // major units
  min_monthly?: number | null;        // major units
  monthly_price?: number | null;      // server-computed major units (optional)
  unit_currency?: string | null;      // e.g. "GBP"

  // legacy names
  unit_price?: number | null;         // major
  unit_price_pence?: number | null;   // pence
  min_monthly_pence?: number | null;  // pence
  monthly_price_pence?: number | null;// pence
};

export default function AreaSponsorModal({
  open,
  onClose,
  businessId,
  areaId,
  areaName,
  onPreviewGeoJSON,
  onClearPreview,
  totalKm2: totalKm2Prop,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [availableKm2, setAvailableKm2] = useState<number | null>(null);
  const [totalKm2, setTotalKm2] = useState<number | null>(totalKm2Prop ?? null);

  const [unitPrice, setUnitPrice] = useState<number | null>(null); // £/km² / month
  const [minMonthly, setMinMonthly] = useState<number | null>(null); // £/month floor
  const [serverMonthly, setServerMonthly] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string>("GBP");

  // Derived computed monthly (if server didn't provide)
  const computedMonthly = useMemo(() => {
    if (serverMonthly != null) return clamp2(serverMonthly);
    if (availableKm2 == null || unitPrice == null) return null;
    const raw = availableKm2 * unitPrice;
    const minApplied = minMonthly != null ? Math.max(minMonthly, raw) : raw;
    return clamp2(minApplied);
  }, [availableKm2, unitPrice, minMonthly, serverMonthly]);

  const isSoldOut = (availableKm2 ?? 0) <= 0;

  // Load preview when opened
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setErr(null);

    async function loadPreview() {
      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId,
            cleanerId: businessId, // alias for older server code
            areaId,
            slot: 1, // single Featured slot
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Preview ${res.status}${text ? `: ${text}` : ""}`);
        }

        const data: PreviewResponse = await res.json();

        if (!data?.ok) {
          throw new Error(data?.error || "Preview not available");
        }
        if (cancelled) return;

        // geometry preview on map
        if (data.geojson && onPreviewGeoJSON) onPreviewGeoJSON(data.geojson);

        // available area
        const avail =
          typeof data.area_km2 === "number" && isFinite(data.area_km2) ? Math.max(0, data.area_km2) : 0;
        setAvailableKm2(avail);

        // total area (prefer prop, otherwise server)
        if (totalKm2Prop == null) {
          const total =
            typeof data.total_km2 === "number" && isFinite(data.total_km2) ? Math.max(0, data.total_km2) : null;
          setTotalKm2(total);
        }

        // currency
        setCurrency(data.unit_currency || "GBP");

        // normalize pricing fields from any server version
        const unit =
          (typeof data.rate_per_km2 === "number" ? data.rate_per_km2 : null) ??
          (typeof data.unit_price === "number" ? data.unit_price : null) ??
          (typeof data.unit_price_pence === "number" ? data.unit_price_pence / 100 : null) ??
          1; // sensible default so UI always works

        const minm =
          (typeof data.min_monthly === "number" ? data.min_monthly : null) ??
          (typeof data.min_monthly_pence === "number" ? data.min_monthly_pence / 100 : null) ??
          1; // sensible default

        const monthly =
          (typeof data.monthly_price === "number" ? data.monthly_price : null) ??
          (typeof data.monthly_price_pence === "number" ? data.monthly_price_pence / 100 : null) ??
          null;

        setUnitPrice(unit);
        setMinMonthly(minm);
        setServerMonthly(monthly);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load preview");
        if (!cancelled && onClearPreview) onClearPreview();
        setAvailableKm2(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPreview();

    return () => {
      cancelled = true;
      onClearPreview?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, businessId, areaId]);

  async function startCheckout() {
    setCheckingOut(true);
    setErr(null);
    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId,
          areaId,
          // Send exactly what we previewed so pricing stays consistent server-side
          preview_km2: availableKm2,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || `Checkout failed (${res.status})`);
      }
      window.location.href = data.url;
    } catch (e: any) {
      setErr(e?.message || "Could not start checkout");
      setCheckingOut(false);
    }
  }

  if (!open) return null;

  // coverage percentage (if we know both)
  const coveragePct =
    Number.isFinite(availableKm2 as number) && Number.isFinite(totalKm2 as number) && (totalKm2 as number) > 0
      ? Math.max(0, Math.min(100, ((availableKm2 as number) / (totalKm2 as number)) * 100))
      : null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl ring-1 ring-black/5 overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-lg">
            Sponsor — {areaName || ""}
          </h3>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="rounded-md border text-xs px-3 py-2 bg-emerald-50 border-emerald-200 text-emerald-800">
            Featured sponsorship makes you first in local search results. Preview highlights the purchasable sub-region.
          </div>

          {isSoldOut && (
            <div className="rounded-md border text-xs px-3 py-2 bg-red-50 border-red-200 text-red-700">
              No purchasable area left for this slot.
            </div>
          )}

          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}

          {/* Pricing grid */}
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Total area" value={fmtKm2(totalKm2)} />
            <Stat
              label="Available area"
              value={loading ? "Loading…" : fmtKm2(availableKm2)}
            />
            <Stat
              label="Price per km² / month"
              value={unitPrice != null ? formatMoney(unitPrice, currency) : "—"}
              hint="From server"
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
            <Stat
              label="Coverage"
              value={
                coveragePct == null ? "—" : `${coveragePct.toFixed(1)}% of your polygon`
              }
            />
          </div>

          <p className="text-xs text-gray-500">
            Your listing will be featured first in results for this coverage.
          </p>
        </div>

        <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={loading || checkingOut}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={startCheckout}
            disabled={loading || checkingOut || isSoldOut}
            title={isSoldOut ? "No purchasable area available" : "Proceed to checkout"}
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
