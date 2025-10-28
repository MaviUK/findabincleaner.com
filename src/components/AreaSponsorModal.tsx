import React, { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;

  // business/area
  businessId: string;
  areaId: string;
  areaName?: string;

  // total area of this service area in km² – computed in the editor and passed in
  totalKm2: number;

  // preview overlay hooks from the editor
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;
};

// Format helpers
const fmtKm2 = (n: number | null | undefined) =>
  Number.isFinite(n as number) ? (n as number).toFixed(4) : "—";
const fmtMoney = (n: number | null | undefined) =>
  Number.isFinite(n as number) ? `£${(n as number).toFixed(2)}` : "—";

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

  // preview result from server (what’s still purchasable)
  const [availableKm2, setAvailableKm2] = useState<number | null>(null);
  const [ratePerKm2, setRatePerKm2] = useState<number | null>(null);

  const monthly = useMemo(() => {
    if (!Number.isFinite(availableKm2 as number) || !Number.isFinite(ratePerKm2 as number))
      return null;
    return (availableKm2 as number) * (ratePerKm2 as number);
  }, [availableKm2, ratePerKm2]);

  // kick off preview (geometry intersection & area that’s still free)
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
            cleanerId: businessId,
            areaId,
            slot: 1, // single featured slot
          }),
        });

        if (!res.ok) {
          setError(`Preview ${res.status}`);
          return;
        }

        const json = await res.json();
        if (!json?.ok) {
          setError(json?.error || "Preview failed");
          return;
        }

        const km2 = Number(json.area_km2 ?? 0);
        setAvailableKm2(Number.isFinite(km2) ? km2 : 0);

        // draw purchasable sub-region on the map
        if (!cancelled && json.geojson && onPreviewGeoJSON) {
          onPreviewGeoJSON(json.geojson);
        }
      } catch (e: any) {
        setError(e?.message || "Preview error");
      } finally {
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
      onClearPreview?.();
    };
  }, [open, businessId, areaId, onPreviewGeoJSON, onClearPreview]);

  // fetch price per km²/month from your Netlify function (env-backed)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadRate() {
      setRateLoading(true);
      try {
        const res = await fetch("/.netlify/functions/area-rate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slot: 1 }), // reuse slot=1 as "Featured"
        });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;

        // Accept either {rate} or {gold,silver,bronze}
        const rate =
          typeof j?.rate === "number"
            ? j.rate
            : typeof j?.gold === "number"
            ? j.gold
            : null;

        setRatePerKm2(rate);
      } finally {
        setRateLoading(false);
      }
    }
    loadRate();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function startCheckout() {
    try {
      setError(null);
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId,
          areaId,
          slot: 1,
          // Send the server the specific purchasable area we previewed,
          // so it can price consistently.
          preview_km2: availableKm2,
        }),
      });
      const j = await res.json();
      if (j?.url) {
        window.location.href = j.url;
      } else {
        setError(j?.error || "Could not start checkout.");
      }
    } catch (e: any) {
      setError(e?.message || "Could not start checkout.");
    }
  }

  if (!open) return null;

  const coveragePct =
    Number.isFinite(availableKm2 as number) && Number.isFinite(totalKm2)
      ? Math.max(0, Math.min(100, ((availableKm2 as number) / (totalKm2 || 1)) * 100))
      : null;

  return (
    <div className="fixed inset-0 z-[99999] grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Sponsor — Featured</div>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div className="rounded-md border text-xs px-3 py-2 bg-emerald-50 border-emerald-200 text-emerald-800">
            Preview shows only the purchasable sub-region on the map.
          </div>

          <div className="text-sm font-medium">Monthly price</div>
          <div className="text-xs text-gray-600">
            Rate: {rateLoading ? "…" : fmtMoney(ratePerKm2)} / km² / month
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <div className="text-gray-500">Available area</div>
              <div className="font-medium">{loading ? "…" : `${fmtKm2(availableKm2)} km²`}</div>
            </div>
            <div>
              <div className="text-gray-500">Total area</div>
              <div className="font-medium">{`${fmtKm2(totalKm2)} km²`}</div>
            </div>
          </div>

          <div className="text-xs text-gray-600">
            Coverage:{" "}
            {coveragePct == null ? "—" : `${coveragePct.toFixed(1)}% of your total polygon`}
          </div>

          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 text-sm pt-2">
            <div className="text-gray-500">Area:</div>
            <div className="font-medium">{fmtKm2(availableKm2)} km²</div>
            <div className="text-gray-500">Monthly: <span className="font-semibold">{fmtMoney(monthly)}</span></div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={startCheckout}
            disabled={!availableKm2 || !ratePerKm2}
          >
            Continue to checkout
          </button>
        </div>
      </div>
    </div>
  );
}
