// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;

  businessId: string; // cleaner/business id – currently unused by the preview, but kept if you later need it
  areaId: string;
  slot: 1 | 2 | 3;

  onPreviewGeoJSON?: (multi: any | null) => void;
  onClearPreview?: () => void;
};

function fmtMoneyPennies(pennies: number | null | undefined) {
  if (pennies == null || !Number.isFinite(pennies)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pennies / 100);
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
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [areaKm2, setAreaKm2] = useState<number | null>(null);
  const [ratePerKm2, setRatePerKm2] = useState<number | null>(null);
  const [priceCents, setPriceCents] = useState<number | null>(null);

  // Clear state when the modal is opened/closed
  useEffect(() => {
    if (!open) {
      setLoading(false);
      setTimedOut(false);
      setError(null);
      setAreaKm2(null);
      setRatePerKm2(null);
      setPriceCents(null);
      onClearPreview?.();
    }
  }, [open, onClearPreview]);

  async function runPreview() {
    setLoading(true);
    setTimedOut(false);
    setError(null);

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000); // 10s hard timeout

    try {
      const res = await fetch("/.netlify/functions/sponsored-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId, areaId, slot }),
        signal: controller.signal,
      });
      clearTimeout(t);

      // Network/HTTP failure
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setError(`Preview failed (${res.status}). ${text || ""}`.trim());
        setLoading(false);
        return;
      }

      const j = await res.json();

      if (!j?.ok) {
        // Server returned ok:false with a reason
        const msg = typeof j?.error === "string" ? j.error : "Preview failed.";
        setError(msg);
        setLoading(false);
        onPreviewGeoJSON?.(null);
        return;
      }

      const km2 = Number(j.area_km2 ?? 0);
      const rate = j.rate_per_km2 == null ? null : Number(j.rate_per_km2);
      const cents = j.price_cents == null ? null : Number(j.price_cents);

      setAreaKm2(Number.isFinite(km2) ? km2 : 0);
      setRatePerKm2(rate != null && Number.isFinite(rate) ? rate : null);
      setPriceCents(cents != null && Number.isFinite(cents) ? cents : null);

      // Draw the purchasable sub-geometry
      if (j.geojson) onPreviewGeoJSON?.(j.geojson);
      else onPreviewGeoJSON?.(null);

      setLoading(false);
    } catch (e: any) {
      clearTimeout(t);
      if (e?.name === "AbortError") {
        setTimedOut(true);
      } else {
        setError(e?.message || "Preview failed.");
      }
      setLoading(false);
      onPreviewGeoJSON?.(null);
    }
  }

  // Kick off preview whenever the modal opens or the slot changes
  useEffect(() => {
    if (!open) return;
    runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, areaId, slot]);

  const rateDisplay = useMemo(() => {
    if (ratePerKm2 == null) return "—";
    // ratePerKm2 is GBP per km² per month
    return `£${ratePerKm2.toFixed(2)} / km² / month`;
  }, [ratePerKm2]);

  return !open ? null : (
    <div className="fixed inset-0 z-[10000] bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-xl bg-white shadow-lg">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <div className="font-semibold">Sponsor #{slot} — {slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze"}</div>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={onClose}>Close</button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-700">
            We’ll only bill the part of your drawn area that’s actually available for slot #{slot}.
          </p>

          <div className="text-[12px] text-teal-800 bg-teal-50 border border-teal-200 rounded px-2 py-1">
            Preview shows only the purchasable sub-region on the map.
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Available area:</div>
            <div className="text-sm text-gray-600">
              {loading ? "—" : areaKm2 != null ? `${areaKm2.toFixed(4)} km²` : "—"}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Monthly price ({slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze"}):</div>
            <div className="text-[12px] text-gray-500">Rate: {rateDisplay}</div>
          </div>

          {timedOut && (
            <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
              Preview timed out. Please try again.
            </div>
          )}
          {!!error && !timedOut && (
            <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <div className="text-sm font-medium">Totals</div>
            <div className="text-sm text-gray-700">
              Area: {areaKm2 != null ? `${areaKm2.toFixed(4)} km²` : "—"} • Monthly: {fmtMoneyPennies(priceCents)}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t flex items-center justify-between gap-3">
          <button className="btn" onClick={onClose}>Cancel</button>
          <div className="flex items-center gap-2">
            <button
              className="btn"
              onClick={runPreview}
              disabled={loading}
              title="Re-run the preview"
            >
              {loading ? "Checking…" : "Retry preview"}
            </button>
            <button
              className="btn btn-primary"
              disabled={loading || !(priceCents != null && areaKm2 != null && areaKm2 > 0)}
              onClick={() => {
                // your existing “Continue to checkout” handler wired wherever you had it
                const evt = new CustomEvent("sponsor:checkout", {
                  detail: { areaId, slot, priceCents, areaKm2, ratePerKm2 },
                });
                window.dispatchEvent(evt);
              }}
            >
              {loading ? "Starting checkout…" : "Continue to checkout"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
