// src/components/AreaSponsorModal.tsx
import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;

  /** BUSINESS id (cleaners.id) */
  cleanerId: string;
  areaId: string;
  slot: 1 | 2 | 3;

  /** Let parent map paint the computed, billable portion of the area. */
  onPreviewGeoJSON?: (multi: any) => void;
  /** Ask parent to clear any painted preview. */
  onClearPreview?: () => void;
};

/** Preview API response types */
type PreviewOk = {
  ok: true;
  area_km2: number;                 // billable area for this slot
  monthly_price: number;            // computed monthly price for this slot
  final_geojson: any | null;        // MultiPolygon of the billable geometry
};

type PreviewErr = {
  ok: false;
  error?: string;
};

type PreviewResp = PreviewOk | PreviewErr;

function isPreviewOk(x: PreviewResp): x is PreviewOk {
  return (x as any)?.ok === true;
}

export default function AreaSponsorModal({
  open,
  onClose,
  cleanerId,
  areaId,
  slot,
  onPreviewGeoJSON,
  onClearPreview,
}: Props) {
  const title = useMemo(() => `Sponsor #${slot}`, [slot]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [areaKm2, setAreaKm2] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);

  // Load the *billable* portion + price when the modal opens
  useEffect(() => {
    const ac = new AbortController();

    async function run() {
      if (!open) return;

      setLoading(true);
      setErr(null);
      setAreaKm2(null);
      setPrice(null);

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cleanerId, areaId, slot }),
          signal: ac.signal,
        });

        const json: PreviewResp = await res.json();
        if (ac.signal.aborted) return;

        if (isPreviewOk(json)) {
          setAreaKm2(json.area_km2);
          setPrice(json.monthly_price);

          // Ask the parent to paint this computed “billable” geometry on the map.
          if (json.final_geojson && onPreviewGeoJSON) {
            onPreviewGeoJSON(json.final_geojson);
          }
        } else {
          const msg = json?.error || "Failed to compute available area";
          throw new Error(msg);
        }
      } catch (e: any) {
        if (!ac.signal.aborted) setErr(e?.message || "Failed to compute available area");
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }

    run();

    // Cleanup / clear painted preview when inputs change or modal closes
    return () => {
      ac.abort();
      onClearPreview?.();
    };
  }, [open, cleanerId, areaId, slot, onPreviewGeoJSON, onClearPreview]);

  async function proceedToCheckout() {
    setLoading(true);
    setErr(null);
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
      setLoading(false);
    }
  }

  // Close helper that also clears the painted preview
  function handleClose() {
    onClearPreview?.();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold">{title}</h3>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={handleClose}>
            Close
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}

          <p className="text-sm text-gray-700">
            Result: Some part of this area is available for #{slot}. We’ll only bill the portion
            that’s actually available for this slot.
          </p>

          <div className="text-sm border rounded p-2 bg-gray-50">
            <div className="flex items-center justify-between">
              <span className="font-medium">Available area for slot #{slot}:</span>
              <span>
                {areaKm2 != null ? `${areaKm2.toFixed(5)} km²` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="font-medium">
                Monthly price ({slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze"}):
              </span>
              <span>
                {price != null ? `£${price.toFixed(2)}/month` : "—"}
              </span>
            </div>

            {loading && (
              <div className="mt-2 text-xs text-gray-500">Computing preview…</div>
            )}
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
