// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;

  businessId: string;
  areaId: string;
  slot: 1 | 2 | 3;

  // map preview hooks
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;
};

function formatGBP(pennies: number | null | undefined) {
  if (pennies == null || !Number.isFinite(pennies)) return "—";
  const pounds = pennies / 100;
  return pounds.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 2,
  });
}

function fmtKm2(n: number | null | undefined) {
  if (!Number.isFinite(n || NaN)) return "—";
  return Number(n).toFixed(4);
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
  const [err, setErr] = useState<string | null>(null);

  const [areaKm2, setAreaKm2] = useState<number | null>(null);
  const [priceCents, setPriceCents] = useState<number | null>(null);
  const [ratePerKm2, setRatePerKm2] = useState<number | null>(null);

  const tierName = useMemo(
    () => (slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze"),
    [slot]
  );

  // Fetch preview (area left + server-side price calc) with robust error handling
  useEffect(() => {
    if (!open) return;

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10000); // 10s hard timeout
    let cancelled = false;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ businessId, areaId, slot }),
          signal: ac.signal,
        });

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

        const km2 = Number(j.area_km2 ?? 0);
        const rate = Number(j.rate_per_km2 ?? NaN);
        const price = Number(j.price_cents ?? NaN);

        setAreaKm2(Number.isFinite(km2) ? km2 : 0);
        setRatePerKm2(Number.isFinite(rate) ? rate : null);
        setPriceCents(Number.isFinite(price) ? price : null);

        if (j.geojson) onPreviewGeoJSON?.(j.geojson);
        else onClearPreview?.();
      } catch (e: any) {
        if (e?.name === "AbortError") {
          setErr("Preview timed out. Please try again.");
        } else {
          setErr(e?.message || "Network error");
        }
        setAreaKm2(null);
        setPriceCents(null);
        onClearPreview?.();
      } finally {
        if (!cancelled) setLoading(false);
        clearTimeout(timeout);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      ac.abort();
      onClearPreview?.();
    };
  }, [open, businessId, areaId, slot, onPreviewGeoJSON, onClearPreview]);

  async function startCheckout() {
    // Keep your existing checkout function/flow if you already have one.
    // This is a safe default that passes identifiers and lets the function
    // re-derive price on the server.
    try {
      setLoading(true);
      setErr(null);

      const res = await fetch("/.netlify/functions/start-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId,
          areaId,
          slot,
          // optional metadata; the backend should recompute price from env
          // but sending these can help with debugging.
          preview_area_km2: areaKm2,
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Checkout ${res.status}${txt ? ` – ${txt}` : ""}`);
      }

      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data?.error || "Could not start checkout.");
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to start checkout.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-xl rounded-xl bg-white shadow-xl ring-1 ring-black/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Sponsor #{slot} — {tierName}</div>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={onClose}>
            Close
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4 space-y-3">
          <p className="text-sm text-gray-700">
            We’ll only bill the part of your drawn area that’s actually available for slot #{slot}.
          </p>

          <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
            Preview shows only the purchasable sub-region on the map.
          </div>

          {/* Summary rows */}
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <div className="text-gray-600">Available area:</div>
              <div className="font-medium">{fmtKm2(areaKm2)} km²</div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-gray-600">Monthly price ({tierName}):</div>
              <div className="font-medium">
                {formatGBP(priceCents)}
              </div>
            </div>

            {ratePerKm2 != null && (
              <div className="text-[11px] text-gray-500">
                Rate: {formatGBP(Math.round(ratePerKm2 * 100))} / km² / month
              </div>
            )}

            {err && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                {err}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 pt-2 flex items-center justify-between gap-3 border-t">
          <div className="text-xs text-gray-500">
            Area: {fmtKm2(areaKm2)} km² • Monthly: {formatGBP(priceCents)}
          </div>

          <div className="flex items-center gap-2">
            <button className="btn" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={startCheckout}
              disabled={loading || !areaKm2 || !priceCents}
              title={!areaKm2 ? "No purchasable area left" : undefined}
            >
              {loading ? "Starting checkout..." : "Continue to checkout"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
