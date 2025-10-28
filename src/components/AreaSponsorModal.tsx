// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Slot = 1 | 2 | 3;

type Props = {
  open: boolean;
  onClose: () => void;

  businessId: string; // cleaner id
  areaId: string;
  slot: Slot;

  // Map preview overlays (optional)
  onPreviewGeoJSON?: (multi: any | null) => void;
  onClearPreview?: () => void;
};

function tierName(slot: Slot) {
  return slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze";
}
function formatMoneyFromCents(cents: number | null | undefined) {
  if (cents == null || !Number.isFinite(Number(cents))) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    Number(cents) / 100
  );
}
function formatRate(ratePerKm2: number | null | undefined) {
  if (ratePerKm2 == null || !Number.isFinite(Number(ratePerKm2))) return "—";
  // Show as £X / km² / month
  return `${new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(Number(ratePerKm2))} / km² / month`;
}

export default function AreaSponsorModal({
  open,
  onClose,
  businessId,
  areaId,
  slot,
  onPreviewGeoJSON,
  onClearPreview,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [areaKm2, setAreaKm2] = useState<number | null>(null);
  const [totalKm2, setTotalKm2] = useState<number | null>(null);
  const [ratePerKm2, setRatePerKm2] = useState<number | null>(null);
  const [priceCents, setPriceCents] = useState<number | null>(null);

  const coveragePct = useMemo(() => {
    if (areaKm2 == null || totalKm2 == null || totalKm2 <= 0) return null;
    return (areaKm2 / totalKm2) * 100;
  }, [areaKm2, totalKm2]);

  // Reset when opening/closing
  useEffect(() => {
    if (!open) {
      setError(null);
      setAreaKm2(null);
      setTotalKm2(null);
      setRatePerKm2(null);
      setPriceCents(null);
      setLoading(false);
      onClearPreview?.();
      return;
    }

    // Fetch preview
    let cancelled = false;
    const ac = new AbortController();
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      try {
        ac.abort();
      } catch {}
    }, 12000); // 12s guard

    (async () => {
      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ businessId, cleanerId: businessId, areaId, slot }),
          signal: ac.signal,
        });

        if (!res.ok) {
          throw new Error(`Preview ${res.status}`);
        }
        const j = await res.json();

        if (!j?.ok) {
          throw new Error(typeof j?.error === "string" ? j.error : "Preview failed");
        }

        const km2 = Number(j.area_km2 ?? 0);
        const total = j.total_km2 == null ? null : Number(j.total_km2);
        const rate = j.rate_per_km2 == null ? null : Number(j.rate_per_km2);
        const cents = j.price_cents == null ? null : Number(j.price_cents);

        if (!cancelled) {
          setAreaKm2(Number.isFinite(km2) ? km2 : 0);
          setTotalKm2(total != null && Number.isFinite(total) ? total : null);
          setRatePerKm2(rate != null && Number.isFinite(rate) ? rate : null);
          setPriceCents(cents != null && Number.isFinite(cents) ? cents : null);
        }

        // Draw purchasable region overlay if provided
        onPreviewGeoJSON?.(j.geojson ?? null);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Preview timed out. Please try again.");
          onPreviewGeoJSON?.(null);
        }
      } finally {
        clearTimeout(timer);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      try {
        ac.abort();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, areaId, slot]);

  async function startCheckout() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId, areaId, slot }),
      });
      const j = await res.json();
      if (!res.ok || !j?.url) {
        throw new Error(j?.error || `Checkout ${res.status}`);
      }
      window.location.href = j.url;
    } catch (e: any) {
      setError(e?.message || "Could not start checkout.");
      setStarting(false);
    }
  }

  if (!open) return null;

  const label = `Sponsor #${slot} — ${tierName(slot)}`;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* Panel */}
      <div className="relative z-10 w-full max-w-xl rounded-xl bg-white shadow-lg border">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">{label}</div>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="text-sm text-gray-700">
            We’ll only bill the part of your drawn area that’s actually available for slot #{slot}.
          </div>

          <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
            Preview shows only the purchasable sub-region on the map.
          </div>

          {/* Rate */}
          <div className="space-y-1">
            <div className="text-sm font-medium">Monthly price ({tierName(slot)}):</div>
            <div className="text-sm text-gray-600">
              Rate: {formatRate(ratePerKm2)}
            </div>
          </div>

          {/* Areas grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">Available area:</div>
              <div className="text-sm text-gray-700">
                {loading ? "—" : areaKm2 != null ? `${areaKm2.toFixed(4)} km²` : "—"}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Total area:</div>
              <div className="text-sm text-gray-700">
                {loading ? "—" : totalKm2 != null ? `${totalKm2.toFixed(4)} km²` : "—"}
              </div>
            </div>
          </div>

          {/* Coverage */}
          {coveragePct != null && (
            <div className="text-sm text-gray-700">
              Coverage: {coveragePct.toFixed(1)}%
            </div>
          )}

          {/* Totals line */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">Area:</span>
            <span className="font-medium">
              {areaKm2 != null ? `${areaKm2.toFixed(4)} km²` : "—"}
            </span>
            <span className="text-gray-300">•</span>
            <span className="text-gray-500">Monthly:</span>
            <span className="font-medium">{formatMoneyFromCents(priceCents)}</span>
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={startCheckout}
            disabled={starting || loading}
          >
            {starting ? "Starting checkout..." : "Continue to checkout"}
          </button>
        </div>
      </div>
    </div>
  );
}
