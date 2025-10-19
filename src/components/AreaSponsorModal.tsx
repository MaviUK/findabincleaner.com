// src/components/AreaSponsorModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  cleanerId: string;     // BUSINESS id (cleaners.id)
  areaId: string;
  slot: 1 | 2 | 3;
  // Optional hooks for the parent map to show the computed (available) GeoJSON
  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;
};

type PreviewOk = {
  ok: true;
  slot: 1 | 2 | 3;
  area_km2: number;
  monthly_price: number;
  final_geojson: any | null; // MultiPolygon of the *available* area for this slot
};

type PreviewErr = { ok?: false; error?: string };
type PreviewResp = PreviewOk | PreviewErr;

export default function AreaSponsorModal({
  open,
  onClose,
  cleanerId,
  areaId,
  slot,
  onPreviewGeoJSON,
  onClearPreview,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [areaKm2, setAreaKm2] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);

  const title = useMemo(() => `Sponsor #${slot}`, [slot]);

  const abortRef = useRef<AbortController | null>(null);

  // Fetch preview whenever the modal opens or inputs change
  useEffect(() => {
    if (!open) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setErr(null);
    setAreaKm2(null);
    setPrice(null);
    setLoading(true);

    (async () => {
      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cleanerId, areaId, slot }),
          signal: ac.signal,
        });

        // Network-level error handling
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `Preview failed (${res.status}). ${text || "Please try again."}`
          );
        }

        const json: PreviewResp = await res.json();

        if (ac.signal.aborted) return;

        if ("ok" in json && json.ok) {
          setAreaKm2(json.area_km2);
          setPrice(json.monthly_price);
          if (json.final_geojson && onPreviewGeoJSON) {
            onPreviewGeoJSON(json.final_geojson);
          }
        } else {
          throw new Error(json?.error || "Failed to compute available area");
        }
      } catch (e: any) {
        if (!ac.signal.aborted) {
          setErr(e?.message || "Failed to compute available area");
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    // cleanup (also clear overlay)
    return () => {
      ac.abort();
      onClearPreview?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cleanerId, areaId, slot]);

  async function proceedToCheckout() {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cleanerId, areaId, slot }),
      });
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data?.error || "Could not start checkout");
      }
    } catch (e: any) {
      setErr(e?.message || "Could not start checkout");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold">{title}</h3>
          <button
            className="text-sm opacity-70 hover:opacity-100"
            onClick={() => {
              onClearPreview?.();
              onClose();
            }}
          >
            Close
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}

          <div className="text-sm">
            Result: Some part of this area is available for #{slot}. We’ll only bill the portion
            that’s actually available for this slot.
          </div>

          <div className="text-sm border rounded p-2">
            <div className="flex items-center justify-between">
              <span>Available area for slot #{slot}:</span>
              <span className="font-medium">
                {areaKm2 != null ? `${areaKm2.toFixed(4)} km²` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Monthly price ({slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze"}):</span>
              <span className="font-medium">
                {price != null ? `£${price.toFixed(2)}/month` : "—"}
              </span>
            </div>
            {loading && <div className="text-xs text-gray-500 mt-1">Computing preview…</div>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <button
            className="btn btn-primary"
            onClick={proceedToCheckout}
            disabled={loading}
          >
            Continue to checkout
          </button>
        </div>
      </div>
    </div>
  );
}
