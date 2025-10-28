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

  // IMPORTANT semantics:
  // - availableKm2  = purchasable sub-region (remaining) for this slot
  // - totalKm2      = full drawn polygon area
  const [availableKm2, setAvailableKm2] = useState<number | null>(null);
  const [totalKm2, setTotalKm2] = useState<number | null>(null);
  const [ratePerKm2, setRatePerKm2] = useState<number | null>(null);
  const [priceCents, setPriceCents] = useState<number | null>(null);

  const coveragePct = useMemo(() => {
    if (availableKm2 == null || totalKm2 == null || totalKm2 <= 0) return null;
    return (availableKm2 / totalKm2) * 100;
  }, [availableKm2, totalKm2]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setAvailableKm2(null);
      setTotalKm2(null);
      setRatePerKm2(null);
      setPriceCents(null);
      setLoading(false);
      onClearPreview?.();
      return;
    }

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

        if (!res.ok) throw new Error(`Preview ${res.status}`);
        const j = await res.json();
        if (!j?.ok) throw new Error(j?.error || "Preview failed");

        // Back-compat + sanity:
        // Some versions return:
        //   - area_km2  = *purchasable* (available)
        //   - total_km2 = *total drawn*
        // Others were accidentally swapped. Fix if inverted.
        let available = Number(
          j.available_km2 ?? j.remaining_km2 ?? j.area_km2 ?? 0
        );
        let total = j.total_km2 != null ? Number(j.total_km2) : null;

        // If server didn’t send total, fall back to drawn if present
        if (total == null && j.drawn_km2 != null) total = Number(j.drawn_km2);

        // If both present and clearly inverted, swap.
        if (
          total != null &&
          Number.isFinite(available) &&
          Number.isFinite(total) &&
          available > total &&
          total > 0
        ) {
          const tmp = available;
          available = total;
          total = tmp;
        }

        // Rate + price: ensure price is available_km2 * rate.
        const rate = j.rate_per_km2 != null ? Number(j.rate_per_km2) : null;
        let price = j.price_cents != null ? Number(j.price_cents) : null;
        if (rate != null && Number.isFinite(rate) && Number.isFinite(available)) {
          const computed = Math.round(available * rate * 100);
          if (!Number.isFinite(price) || Math.abs(computed - Number(price)) > 1) {
            price = computed;
          }
        }

        if (!cancelled) {
          setAvailableKm2(Number.isFinite(available) ? available : 0);
          setTotalKm2(total != null && Number.isFinite(total) ? total : null);
          setRatePerKm2(rate != null && Number.isFinite(rate) ? rate : null);
          setPriceCents(price != null && Number.isFinite(price) ? price : null);
        }

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
      if (!res.ok || !j?.url) throw new Error(j?.error || `Checkout ${res.status}`);
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
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
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

          <div className="space-y-1">
            <div className="text-sm font-medium">Monthly price ({tierName(slot)}):</div>
            <div className="text-sm text-gray-600">Rate: {formatRate(ratePerKm2)}</div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">Available area:</div>
              <div className="text-sm text-gray-700">
                {loading ? "—" : availableKm2 != null ? `${availableKm2.toFixed(4)} km²` : "—"}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Total area:</div>
              <div className="text-sm text-gray-700">
                {loading ? "—" : totalKm2 != null ? `${totalKm2.toFixed(4)} km²` : "—"}
              </div>
            </div>
          </div>

          {coveragePct != null && (
            <div className="text-sm text-gray-700">Coverage: {coveragePct.toFixed(1)}%</div>
          )}

          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">Area:</span>
            <span className="font-medium">
              {availableKm2 != null ? `${availableKm2.toFixed(4)} km²` : "—"}
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
