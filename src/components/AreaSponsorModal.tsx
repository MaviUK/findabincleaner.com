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

const RATE_KEYS = {
  1: "RATE_GOLD_PER_KM2_PER_MONTH", // keep using your existing env var on server
} as const;

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
  const slot = 1; // single-slot model

  const [loading, setLoading] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const [totalKm2, setTotalKm2] = useState<number | null>(null);
  const [availKm2, setAvailKm2] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // fetch price rate (server reads env vars; client does NOT)
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);
      try {
        // ask server for the rate key we use for slot 1
        const res = await fetch("/.netlify/functions/area-pricing", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slot }),
        });
        if (!res.ok) throw new Error(`rate ${res.status}`);
        const j = await res.json();
        if (!cancelled) setRate(Number(j?.rate_per_km2 ?? 0));
      } catch (e: any) {
        if (!cancelled) setRate(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (open) run();
    return () => {
      cancelled = true;
    };
  }, [open, slot]);

  // preview available + total area; also draw the purchasable sub-region
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setErr(null);
      setAvailKm2(null);
      try {
        // available area (purchasable sub-region with overlaps applied)
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ businessId, areaId, slot }), // slot=1
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

    // total area (original polygon)
    async function total() {
      try {
        const res = await fetch("/.netlify/functions/area-total", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ areaId }),
        });
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setTotalKm2(Number(j?.total_km2 ?? 0));
      } catch {
        /* ignore */
      }
    }

    if (open) {
      run();
      total();
    }
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

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title">Sponsor — Featured listing</div>
          <button onClick={onClose} className="icon-btn">Close</button>
        </div>

        <div className="space-y-3">
          <div className="text-sm rounded bg-emerald-50 border border-emerald-200 px-3 py-2">
            Preview shows only the purchasable sub-region on the map.
          </div>

          <div className="space-y-1">
            <div className="font-medium">Monthly price</div>
            <div className="text-xs text-gray-500">Rate: {rate == null ? "—" : `${money(rate)} / km² / month`}</div>
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

        <div className="modal-foot">
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
                    // the server will compute final price from env + km2 at order time
                  }),
                });
                const j = await res.json();
                if (j?.url) window.location.href = j.url;
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
