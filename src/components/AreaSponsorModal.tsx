// src/components/AreaSponsorModal.tsx
import React, { useEffect, useState } from "react";

type Slot = 1 | 2 | 3;

type PreviewOk = {
  ok: true;
  area_km2: number;
  monthly_price: number;
  final_geojson: any | null;
};
type PreviewErr = { ok?: false; error?: string };
type PreviewResp = PreviewOk | PreviewErr;

type Props = {
  open: boolean;
  onClose: () => void;
  cleanerId: string;
  areaId: string;
  slot: Slot;

  /** Optional: when preview returns a clipped MultiPolygon, draw it on the map */
  onPreviewGeoJSON?: (multi: any) => void;
  /** Optional: clear any previously drawn preview overlay */
  onClearPreview?: () => void;
};

export default function AreaSponsorModal({
  open,
  onClose,
  cleanerId,
  areaId,
  slot,
  onPreviewGeoJSON,
  onClearPreview,
}: Props) {
  const [computing, setComputing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [areaKm2, setAreaKm2] = useState<number | null>(null);
  const [monthly, setMonthly] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Fetch preview once per open; cancel on close; clear overlay on cleanup
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const controller = new AbortController();

    // Clear any old overlay while we compute a new one
    onClearPreview?.();

    async function run() {
      setErr(null);
      setComputing(true);
      setAreaKm2(null);
      setMonthly(null);

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cleanerId, areaId, slot }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`Preview ${res.status}${txt ? ` – ${txt}` : ""}`);
        }

        const json: PreviewResp = await res.json();
        if (cancelled || controller.signal.aborted) return;

        if (!("ok" in json) || !json.ok) {
          throw new Error((json as PreviewErr)?.error || "Failed to compute preview");
        }

        setAreaKm2(json.area_km2);
        setMonthly(json.monthly_price);

        if (json.final_geojson && onPreviewGeoJSON) {
          onPreviewGeoJSON(json.final_geojson);
        }
      } catch (e: any) {
        if (!cancelled && !controller.signal.aborted) {
          setErr(e?.message || "Failed to compute preview");
        }
      } finally {
        if (!cancelled && !controller.signal.aborted) {
          setComputing(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
      controller.abort();
      onClearPreview?.();
    };
    // Intentionally minimal deps: run exactly once per logical open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cleanerId, areaId, slot]);

  if (!open) return null;

  const labelForSlot = (s: Slot) =>
    s === 1 ? "Gold" : s === 2 ? "Silver" : "Bronze";

  async function handleCheckout() {
    setCheckingOut(true);
    setErr(null);
    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cleanerId, areaId, slot }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Checkout ${res.status}${txt ? ` – ${txt}` : ""}`);
      }
      const json = await res.json();
      if (!json?.url) throw new Error("No checkout URL returned");
      window.location.href = json.url;
    } catch (e: any) {
      setErr(e?.message || "Failed to start checkout");
      setCheckingOut(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Sponsor #{slot}</div>
          <button className="text-gray-600 hover:text-black" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}

          <p className="text-sm text-gray-700">
            Some part of this area is available for #{slot}. We’ll only bill the
            portion that’s actually available for this slot.
          </p>

          <div className="border rounded p-3 text-sm text-gray-800">
            <div className="flex items-center justify-between">
              <span>Available area for slot #{slot}:</span>
              <span className="tabular-nums">
                {areaKm2 == null ? "—" : `${areaKm2.toFixed(4)} km²`}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span>Monthly price ({labelForSlot(slot)}):</span>
              <span className="tabular-nums">
                {monthly == null ? "—" : `£${monthly.toFixed(2)}/month`}
              </span>
            </div>

            {computing && (
              <div className="mt-2 text-xs text-gray-500">Computing preview…</div>
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-t flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={checkingOut}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleCheckout}
            disabled={checkingOut || computing}
            title={computing ? "Please wait for the preview" : undefined}
          >
            {checkingOut ? "Starting checkout…" : "Continue to checkout"}
          </button>
        </div>
      </div>
    </div>
  );
}
