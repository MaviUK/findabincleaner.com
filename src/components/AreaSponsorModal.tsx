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
  area_km2: number;
  monthly_price: number;
  final_geojson: any | null;
};
type PreviewErr = { ok: false; error?: string };
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

  // Separate states so preview can hang/fail without blocking checkout
  const [computing, setComputing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [areaKm2, setAreaKm2] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);

  // Load the *billable* portion + price when the modal opens
  useEffect(() => {
    const ac = new AbortController();

    async function run() {
      if (!open) return;

      setComputing(true);
      setErr(null);
      setAreaKm2(null);
      setPrice(null);

      try {
        // Optional: 12s timeout so we don't hang forever
        const timeout = new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error("Preview timed out")), 12000)
        );

        const req = fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cleanerId, areaId, slot }),
          signal: ac.signal,
        });

        const res = (await Promise.race([req, timeout])) as Response;
        const json: PreviewResp = await res.json();
        if (ac.signal.aborted) return;

        if (isPreviewOk(json)) {
          setAreaKm2(json.area_km2);
          setPrice(json.monthly_price);
          if (json.final_geojson && onPreviewGeoJSON) onPreviewGeoJSON(json.final_geojson);
        } else {
          const msg = json?.error || "Failed to compute available area";
          setErr(msg);
        }
      } catch (e: any) {
        if (!ac.signal.aborted) setErr(e?.message || "Failed to compute available area");
      } finally {
        if (!ac.signal.aborted) setComputing(false);
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
    setCheckingOut(true);
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
      setCheckingOut(false);
    }
  }

  // Close helper that also clears the painted preview
  function handleClose() {
    onClearPreview?.();
    onClose();
  }

  if (!open) return null;

  const tierName = slot === 1 ? "Gold" : slot === 2 ? "Silver" : "Bronze";

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
              {err} — you can still continue to checkout; pricing will be finalized by Stripe/webhooks.
            </div>
          )}

          <p className="text-sm text-gray-700">
            Some part of this area is available for #{slot}. We’ll only bill the portion that’s actually
            available for this slot.
          </p>

          <div className="text-sm border rounded p-2 bg-gray-50">
            <div className="flex items-center justify-between">
              <span className="font-medium">Available area for slot #{slot}:</span>
              <span>{areaKm2 != null ? `${areaKm2.toFixed(5)} km²` : "—"}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="font-medium">Monthly price ({tierName}):</span>
              <span>{price != null ? `£${price.toFixed(2)}/month` : "—"}</span>
            </div>
            {computing && <div className="mt-2 text-xs text-gray-500">Computing preview…</div>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <button className="btn btn-primary" onClick={proceedToCheckout} disabled={checkingOut}>
            {checkingOut ? "Starting checkout…" : "Continue to checkout"}
          </button>
        </div>
      </div>
    </div>
  );
}
