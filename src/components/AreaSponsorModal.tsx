// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;

  // business / area
  businessId: string; // cleaner/business id
  areaId: string;     // service area id
  areaName?: string;

  // total area of this service area in km² – optional (UI will also accept total_km2 from server)
  totalKm2?: number;

  // Map overlay callbacks from the editor (optional)
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;

  // Kept for compatibility while removing it elsewhere; ignored here.
  slot?: unknown;
};

type PreviewResponse = {
  ok: boolean;
  error?: string;
  geojson?: any;
  area_km2?: number;     // purchasable area for Featured slot
  total_km2?: number;    // total service area size

  // Optional pricing (major units)
  unit_price?: number;       // per km² / month
  unit_currency?: string;    // e.g., "GBP"
  min_monthly?: number;      // minimum monthly
  monthly_price?: number;    // server-computed monthly

  // Pence fallbacks
  unit_price_pence?: number;
  min_monthly_pence?: number;
  monthly_price_pence?: number;
};

const fmtKm2 = (n: number | null | undefined) =>
  Number.isFinite(n as number) ? (n as number).toFixed(3) : "—";

function money(n?: number | null, currency = "GBP") {
  if (n == null || !isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `£${(+n).toFixed(2)}`;
  }
}

function round2(n: number) {
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
  // loading / error states
  const [previewLoading, setPreviewLoading] = useState(false);
  const [rateLoading, setRateLoading] = useState(false);
  const loading = previewLoading || rateLoading;

  const [error, setError] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);

  // preview / pricing state
  const [availableKm2, setAvailableKm2] = useState<number | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);

  const [currency, setCurrency] = useState("GBP");
  const [unitPrice, setUnitPrice] = useState<number | null>(null); // per km² / month
  const [minMonthly, setMinMonthly] = useState<number | null>(null);
  const [serverMonthly, setServerMonthly] = useState<number | null>(null);
  const [ratePerKm2, setRatePerKm2] = useState<number | null>(null); // optional /area-rate

  // total area (from server; used if caller doesn't pass totalKm2)
  const [totalKm2Server, setTotalKm2Server] = useState<number | null>(null);

  // occupancy (is this area already taken by someone else?)
  const [occupiedByOther, setOccupiedByOther] = useState<boolean | null>(null);

  const effectiveUnit = unitPrice ?? ratePerKm2;
  const derivedTotalKm2 = totalKm2 ?? totalKm2Server ?? null;

  const computedMonthly = useMemo(() => {
    if (serverMonthly != null) return round2(serverMonthly);
    if (availableKm2 == null || effectiveUnit == null) return null;
    const raw = availableKm2 * effectiveUnit;
    const withMin = minMonthly != null ? Math.max(minMonthly, raw) : raw;
    return round2(withMin);
  }, [availableKm2, effectiveUnit, minMonthly, serverMonthly]);

  const coveragePct = useMemo(() => {
    if (availableKm2 == null || derivedTotalKm2 == null || derivedTotalKm2 === 0) return null;
    return Math.max(0, Math.min(100, (availableKm2 / derivedTotalKm2) * 100));
  }, [availableKm2, derivedTotalKm2]);

  // Load preview (single Featured slot; server may ignore slot)
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
            slot: 1, // kept for back-compat
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

        // pricing (prefer major units; fallback to pence)
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

        // accept total area from server (for coverage)
        if (typeof data.total_km2 === "number" && isFinite(data.total_km2)) {
          setTotalKm2Server(Math.max(0, data.total_km2));
        }
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
  }, [open, businessId, areaId]); // deliberately avoid callback identities

  // Optional back-compat rate endpoint
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setRateLoading(true);

    (async () => {
      try {
        const res = await fetch("/.netlify/functions/area-rate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slot: 1 }),
        });
        if (!res.ok) return;

        const j = await res.json();
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
  }, [open]);

  // Occupancy (is the area already taken by another business?)
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/.netlify/functions/area-sponsorship", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ areaIds: [areaId] }),
        });
        if (!res.ok) { if (!cancelled) setOccupiedByOther(null); return; }
        const { areas } = await res.json();

        const rec = areas?.[0];
        // Support both shapes: simple {taken, owner_business_id} or slots[0]
        const taken = rec?.taken ?? rec?.slots?.[0]?.taken;
        const owner = rec?.owner_business_id ?? rec?.slots?.[0]?.owner_business_id;

        if (!cancelled) setOccupiedByOther(Boolean(taken && owner && owner !== businessId));
      } catch {
        if (!cancelled) setOccupiedByOther(null);
      }
    })();

    return () => { cancelled = true; };
  }, [open, areaId, businessId]);

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
          slot: 1, // ignored server-side in single-slot world
          preview_km2: availableKm2,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || "Could not start checkout");
      }
      window.location.href = data.url;
    } catch (e: any) {
      setError(e?.message || "Could not start checkout.");
      setCheckingOut(false);
    }
  }

  if (!open) return null;

  // unified availability rule
  const soldOut =
    (availableKm2 != null && availableKm2 <= 0) || occupiedByOther === true;

  const canCheckout =
    !loading && !checkingOut && !soldOut && availableKm2 != null && availableKm2 > 0;

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
            Featured sponsorship makes you first in local search results. Preview highlights the purchasable sub‑region.
          </div>

          {soldOut && (
            <div className="rounded-md border text-xs px-3 py-2 bg-yellow-50 border-yellow-200 text-yellow-800">
              This area isn’t available to purchase right now.
            </div>
          )}

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
              : effectiveUnit != null
              ? `${money(effectiveUnit, currency)} / km² / month`
              : "—"}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Stat
              label="Total area"
              value={
                derivedTotalKm2 != null ? `${fmtKm2(derivedTotalKm2)} km²` : "—"
              }
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
                effectiveUnit != null ? money(effectiveUnit, currency) : "—"
              }
              hint={unitPrice != null ? "From server" : undefined}
            />
            <Stat
              label="Minimum monthly"
              value={minMonthly != null ? money(minMonthly, currency) : "—"}
              hint="Floor price"
            />
            <Stat
              label="Your monthly price"
              value={
                loading
                  ? "Loading…"
                  : computedMonthly != null
                  ? money(computedMonthly, currency)
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
                occupiedByOther === true
                  ? "Taken"
                  : previewLoaded
                  ? (availableKm2 != null && availableKm2 > 0 ? "Available" : "Not available")
                  : "Checking…"
              }
            />
          </div>

          <p className="text-xs text-gray-500">
            Your listing will be featured first in results for this coverage.
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
