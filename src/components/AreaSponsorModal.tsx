// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;

  // ids
  businessId: string;
  areaId: string;
  areaName?: string;

  // Optional map overlay hooks from the editor
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;
};

// small helpers
function clamp2(n: number) {
  return Math.max(0, Math.round(n * 100) / 100);
}
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

export default function AreaSponsorModal({
  open,
  onClose,
  businessId,
  areaId,
  areaName,
  onPreviewGeoJSON,
  onClearPreview,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // geometry/area
  const [totalKm2, setTotalKm2] = useState<number | null>(null);
  const [availableKm2, setAvailableKm2] = useState<number | null>(null);

  // pricing (major units)
  const [unitPrice, setUnitPrice] = useState<number | null>(null);
  const [minMonthly, setMinMonthly] = useState<number | null>(null);
  const [serverMonthly, setServerMonthly] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string>("GBP");

  // saleability
  const [soldOut, setSoldOut] = useState<boolean>(false);
  const [isOwner, setIsOwner] = useState<boolean>(false);
  const [ownerBusinessId, setOwnerBusinessId] = useState<string | null>(null);

  const computedMonthly = useMemo(() => {
    if (serverMonthly != null) return clamp2(serverMonthly);
    if (availableKm2 == null || unitPrice == null) return null;
    const raw = availableKm2 * unitPrice;
    const minApplied = minMonthly != null ? Math.max(minMonthly, raw) : raw;
    return clamp2(minApplied);
  }, [availableKm2, unitPrice, minMonthly, serverMonthly]);

  const coveragePct = useMemo(() => {
    if (availableKm2 == null || totalKm2 == null || totalKm2 <= 0) return null;
    return Math.max(0, Math.min(100, (availableKm2 / totalKm2) * 100));
  }, [availableKm2, totalKm2]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId,
            cleanerId: businessId, // tolerate older server code
            areaId,
          }),
        });

        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) {
          throw new Error(
            j?.error || `Preview ${res.status} ${res.statusText || ""}`.trim()
          );
        }
        if (cancelled) return;

        // geometry + overlay
        const geo = j.geojson ?? null;
        if (geo && onPreviewGeoJSON) onPreviewGeoJSON(geo);
        if (!geo && onClearPreview) onClearPreview();

        // areas
        const total = Number(j.total_km2 ?? null);
        const avail = Number(j.area_km2 ?? null);
        setTotalKm2(Number.isFinite(total) ? total : null);
        setAvailableKm2(Number.isFinite(avail) ? avail : null);

        // pricing (major units from server)
        const unit = Number(j.unit_price ?? null);
        const minm = Number(j.min_monthly ?? null);
        const monthly = Number(j.monthly_price ?? null);
        const curr = typeof j.unit_currency === "string" ? j.unit_currency : "GBP";
        setUnitPrice(Number.isFinite(unit) ? unit : null);
        setMinMonthly(Number.isFinite(minm) ? minm : null);
        setServerMonthly(Number.isFinite(monthly) ? monthly : null);
        setCurrency(curr);

        // saleability
        setSoldOut(Boolean(j.sold_out));
        setIsOwner(Boolean(j.is_owner));
        setOwnerBusinessId(j.sold_to_business_id || null);
      } catch (e: any) {
        setError(e?.message || "Failed to load preview");
        setTotalKm2(null);
        setAvailableKm2(null);
        setUnitPrice(null);
        setMinMonthly(null);
        setServerMonthly(null);
        setSoldOut(false);
        setIsOwner(false);
        setOwnerBusinessId(null);
        if (onClearPreview) onClearPreview();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
      onClearPreview?.();
    };
  }, [open, businessId, areaId, onPreviewGeoJSON, onClearPreview]);

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
          preview_km2: availableKm2, // keep price consistent with preview
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok || !j?.url) {
        throw new Error(j?.error || "Could not start checkout");
      }
      window.location.href = j.url;
    } catch (e: any) {
      setError(e?.message || "Could not start checkout.");
      setCheckingOut(false);
    }
  }

  function close() {
    onClearPreview?.();
    onClose();
  }

  if (!open) return null;

  const total = totalKm2;
  const avail = availableKm2;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl ring-1 ring-black/5 overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-lg">
            Sponsor — {areaName || ""}
          </h3>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={close}>
            Close
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="rounded-md border text-xs px-3 py-2 bg-emerald-50 border-emerald-200 text-emerald-800">
            Featured sponsorship makes you first in local search results. Preview highlights the purchasable sub-region.
          </div>

          {soldOut && !isOwner && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              No purchasable area left for this slot. Another business already sponsors this area.
            </div>
          )}

          {isOwner && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              You already sponsor this area.
            </div>
          )}

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Stat
              label="Total area"
              value={total != null ? `${total.toFixed(3)} km²` : "—"}
            />
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
                coveragePct == null
                  ? "—"
                  : `${coveragePct.toFixed(1)}% of your polygon`
              }
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
          <button className="btn" onClick={close} disabled={loading || checkingOut}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={startCheckout}
            disabled={
              loading ||
              checkingOut ||
              soldOut ||
              isOwner ||
              !avail ||
              avail <= 0
            }
            title={
              soldOut
                ? "Area already has a Featured sponsor"
                : isOwner
                ? "You already sponsor this area"
                : !avail || avail <= 0
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
      <div className={"mt-1 " + (emphasis ? "text-xl font-semibold" : "text-base font-medium")}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-gray-400 mt-1">{hint}</div>}
    </div>
  );
}
