// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  businessId: string; // cleanerId
  areaId: string;
  onPreviewGeoJSON?: (multi: any | null) => void;
  onClearPreview?: () => void;
};

// simple money formatter
const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(n);

export default function AreaSponsorModal({
  open,
  onClose,
  businessId,
  areaId,
  onPreviewGeoJSON,
  onClearPreview,
}: Props) {
  const slot = 1;

  const [loadingRate, setLoadingRate] = useState(false);
  const [rate, setRate] = useState<number | null>(null);

  const [totalKm2, setTotalKm2] = useState<number | null>(null);
  const [availKm2, setAvailKm2] = useState<number | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // price rate (server reads env vars; client does NOT)
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!open) return;
      setLoadingRate(true);
      try {
        const res = await fetch("/.netlify/functions/area-pricing", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slot }),
        });
        if (!res.ok) throw new Error(`rate ${res.status}`);
        const j = await res.json();
        if (!cancelled) setRate(Number(j?.rate_per_km2 ?? 0));
      } catch {
        if (!cancelled) setRate(null);
      } finally {
        if (!cancelled) setLoadingRate(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [open, slot]);

  // preview available + total area; draw the purchasable sub-region
  useEffect(() => {
    let cancelled = false;
    if (!open) return;

    async function preview() {
      setErr(null);
      setAvailKm2(null);
      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ businessId, areaId, slot }),
        });
        if (!res.ok) throw new Error(`preview ${res.status}`);
        const j = await res.json();
        if (!j?.ok) throw new Error(j?.error || "Preview failed");
        if (!cancelled) {
          setAvailKm2(Number(j.area_km2 ?? 0));
          onPreviewGeoJSON?.(j.geojson ?? null);
        }
      } catch (e: any) {
        if (!cancelled) setErr("Preview timed out. Please try again.");
        onClearPreview?.();
      }
    }

    async function total() {
      try {
        const res = await fetch("/.netlify/functions/area-total", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ areaId }),
        });
        if (!res.ok) return; // quietly ignore if function isn’t present
        const j = await res.json();
        if (!cancelled) setTotalKm2(Number(j?.total_km2 ?? 0));
      } catch {
        // ignore
      }
    }

    preview();
    total();

    return () => {
      cancelled = true;
      onClearPreview?.();
    };
  }, [open, areaId, businessId, slot, onPreviewGeoJSON, onClearPreview]);

  const monthly = useMemo(() => {
    if (rate == null || availKm2 == null) return null;
    return rate * availKm2;
  }, [rate, availKm2]);

  if (!open) return null;

  // Tailwind overlay modal
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Sponsor — Featured listing</h3>
          <button onClick={onClose} className="text-sm text-gray-600 hover:text-black">Close</button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-sm rounded bg-emerald-50 border border-emerald-200 px-3 py-2">
            Preview shows only the purchasable sub-region on the map.
          </div>

          <div>
            <div className="font-medium">Monthly price</div>
            <div className="text-xs text-gray-500">
              Rate: {loadingRate ? "…" : rate == null ? "—" : `${money(rate)} / km² / month`}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-xs text-gray-500">Available area (billable)</div>
              <div className="font-medium">{availKm2 == null ? "—" : `${availKm2.toFixed(4)} km²`}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Total area (your polygon)</div>
              <div className="font-medium">{totalKm2 == null ? "—" : `${totalKm2.toFixed(4)} km²`}</div>
            </div>
          </div>

          {err && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded">
              {err}
            </div>
          )}

          <div className="flex items-center gap-3 text-sm">
            <div className="text-gray-500">Monthly:</div>
            <div className="font-semibold">{monthly == null ? "—" : money(monthly)}</div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={starting || rate == null || availKm2 == null || availKm2 <= 0}
            onClick={async () => {
              try {
                setStarting(true);
                const res = await fetch("/.netlify/functions/sponsored-checkout", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    areaId,
                    cleanerId: businessId,
                    slot, // 1
                  }),
                });
                const j = await res.json();
                if (j?.url) window.location.href = j.url;
                // if server blocks due to ownership, it should return 409 with error
              } finally {
                setStarting(false);
              }
            }}
          >
            Continue to checkout
          </button>
        </div>
      </div>
    </div>
  );
}
