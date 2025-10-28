// src/components/AreaSponsorModal.tsx
import React, { useEffect, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  businessId: string;
  areaId: string;
  slot: 1 | 2 | 3;
  onPreviewGeoJSON?: (multi: any | null) => void;   // draw the green preview on the map
  onClearPreview?: () => void;
};

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
  const [err, setErr] = useState<string | null>(null);
  const [areaKm2, setAreaKm2] = useState<number | null>(null);
  const [priceCents, setPriceCents] = useState<number | null>(null);
  const [ratePerKm2, setRatePerKm2] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!open) return;
      setLoading(true);
      setErr(null);

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ businessId, areaId, slot }),
        });

        // Don’t blow up UI on 4xx/5xx, just show a friendly error
        if (!res.ok) {
          setErr(`Preview ${res.status}`);
          setAreaKm2(null);
          setPriceCents(null);
          onClearPreview?.();
          return;
        }

        const j = await res.json();
        if (!j?.ok) {
          setErr(j?.error || "Preview failed");
          setAreaKm2(null);
          setPriceCents(null);
          onClearPreview?.();
          return;
        }

        if (cancelled) return;

        setAreaKm2(Number(j.area_km2 ?? 0));
        setPriceCents(
          typeof j.price_cents === "number" && Number.isFinite(j.price_cents)
            ? j.price_cents
            : null
        );
        setRatePerKm2(
          typeof j.rate_per_km2 === "number" && Number.isFinite(j.rate_per_km2)
            ? j.rate_per_km2
            : null
        );

        // Draw green preview on the map
        if (j.geojson) onPreviewGeoJSON?.(j.geojson);
        else onClearPreview?.();
      } catch (e: any) {
        if (!cancelled) {
          setErr(e?.message || "Network error");
          onClearPreview?.();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
      onClearPreview?.();
    };
  }, [open, businessId, areaId, slot, onPreviewGeoJSON, onClearPreview]);

  const monthlyText =
    priceCents == null ? "—" : `£${(priceCents / 100).toFixed(2)}`;

  return !open ? null : (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold">Sponsor #{slot} — {slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze"}</div>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={onClose}>Close</button>
        </div>

        <div className="p-4 space-y-3">
          {err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}

          <div className="text-sm">
            We’ll only bill the part of your drawn area that’s actually available for slot #{slot}.
          </div>

          <label className="block text-xs text-gray-500">Available area:</label>
          <div className="input">
            {loading ? "Loading…" : (areaKm2 ?? 0).toFixed(4)} km²
          </div>

          <label className="block text-xs text-gray-500">Monthly price ({slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze"}):</label>
          <div className="input">{loading ? "Loading…" : monthlyText}</div>

          <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
            Preview shows only the purchasable sub-region on the map.
          </div>

          <div className="input flex items-center gap-2">
            <span>Area: {(areaKm2 ?? 0).toFixed(4)} km²</span>
            <span className="opacity-60">•</span>
            <span>Monthly: {monthlyText}</span>
          </div>
        </div>

        <div className="p-4 border-t flex items-center justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={loading || !priceCents}>
            {loading ? "Starting checkout…" : "Continue to checkout"}
          </button>
        </div>
      </div>
    </div>
  );
}
