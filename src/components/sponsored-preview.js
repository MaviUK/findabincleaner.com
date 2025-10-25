// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useState } from "react";

type Slot = 1 | 2 | 3;

type PreviewOk = {
  ok: true;
  area_km2: number | string;
  monthly_price: number | string;
  final_geojson: any | null; // preferred geometry key
  // tolerated alternates for back-compat
  available?: any;
  available_gj?: any;
  available_geojson?: any;
  geometry?: any;
  geojson?: any;
  multi?: any;
};
type PreviewErr = { ok?: false; error?: string };
type PreviewResp = PreviewOk | PreviewErr;

type Props = {
  open: boolean;
  onClose: () => void;
  /** businessId == cleanerId (same UUID in your DB) */
  businessId: string;
  areaId: string;
  slot: Slot;

  onPreviewGeoJSON?: (multi: any) => void;
  onClearPreview?: () => void;
};

function labelForSlot(s: Slot) {
  return s === 1 ? "Gold" : s === 2 ? "Silver" : "Bronze";
}

function pickClippedGeom(json: any) {
  return (
    json?.final_geojson ??
    json?.available ??
    json?.available_gj ??
    json?.available_geojson ??
    json?.geometry ??
    json?.geojson ??
    json?.multi ??
    null
  );
}

/** Call preview and return numbers + (optional) geometry */
async function callPreview(opts: {
  cleanerId: string;
  areaId: string;
  slot: Slot;
  signal?: AbortSignal;
}) {
  const { cleanerId, areaId, slot, signal } = opts;

  const res = await fetch("/.netlify/functions/sponsored-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // send synonyms so any backend version accepts it
    body: JSON.stringify({
      cleanerId,
      businessId: cleanerId,
      areaId,
      area_id: areaId,
      slot: Number(slot),
    }),
    signal,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Preview ${res.status}${txt ? ` – ${txt}` : ""}`);
  }

  const json: PreviewResp = await res.json();
  if (!("ok" in json) || !json.ok) {
    throw new Error((json as PreviewErr)?.error || "Failed to compute preview");
  }

  const areaNum = Number((json as PreviewOk).area_km2);
  const monthlyNum = Number((json as PreviewOk).monthly_price);
  const geom = pickClippedGeom(json);

  return {
    km2: Number.isFinite(areaNum) ? areaNum : 0,
    monthly: Number.isFinite(monthlyNum) ? monthlyNum : null,
    geom,
  };
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
  const cleanerId = businessId;

  const [computing, setComputing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [areaKm2, setAreaKm2] = useState<number | null>(null);
  const [monthly, setMonthly] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wasClipped, setWasClipped] = useState<boolean>(false);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Compute preview and draw clipped overlay
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const controller = new AbortController();

    onClearPreview?.();
    setErr(null);
    setComputing(true);
    setAreaKm2(null);
    setMonthly(null);
    setWasClipped(false);

    (async () => {
      try {
        const { km2, monthly, geom } = await callPreview({
          cleanerId,
          areaId,
          slot,
          signal: controller.signal,
        });

        if (cancelled || controller.signal.aborted) return;

        setAreaKm2(km2);
        setMonthly(monthly);

        if (geom && onPreviewGeoJSON) {
          setWasClipped(true);
          onPreviewGeoJSON(geom);
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
    })();

    return () => {
      cancelled = true;
      controller.abort();
      onClearPreview?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cleanerId, areaId, slot]);

  const nfGBP = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 2,
      }),
    []
  );

  const priceLine = useMemo(() => {
    if (areaKm2 == null && monthly == null) return "—";
    const a = areaKm2 == null ? "—" : `${areaKm2.toFixed(4)} km²`;
    const m = monthly == null ? "—" : `${nfGBP.format(monthly)}/month`;
    return `Area: ${a} · Monthly: ${m}`;
  }, [areaKm2, monthly, nfGBP]);

  const hasPurchasableRegion = areaKm2 !== null && areaKm2 > 0;

  function handleClose() {
    onClearPreview?.();
    onClose();
  }

  // HARD GATE: re-check using preview again just before checkout
  async function handleCheckout() {
    try {
      const { km2 } = await callPreview({ cleanerId, areaId, slot });
      if (!Number.isFinite(km2) || km2 <= 0) {
        setErr(
          `This slot has no purchasable area left. Another business already has Sponsor #${slot} here.`
        );
        return;
      }
    } catch (e: any) {
      setErr(e?.message || "Could not verify availability.");
      return;
    }

    setCheckingOut(true);
    setErr(null);
    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cleanerId,
          businessId: cleanerId,
          areaId,
          area_id: areaId,
          slot: Number(slot),
          return_url: typeof window !== "undefined" ? window.location.origin : undefined,
        }),
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">
            Sponsor #{slot} — {labelForSlot(slot)}
          </div>
          <button
            className="text-gray-600 hover:text-black disabled:opacity-50"
            onClick={handleClose}
            disabled={computing || checkingOut}
            aria-label="Close"
          >
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
            We’ll only bill the part of your drawn area that’s actually available for slot #{slot}.
          </p>

          <div className="border rounded p-3 text-sm text-gray-800">
            <div className="flex items-center justify-between">
              <span>Available area:</span>
              <span className="tabular-nums">
                {areaKm2 == null ? "—" : `${areaKm2.toFixed(4)} km²`}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span>
                Monthly price (<span className="font-medium">{labelForSlot(slot)}</span>):
              </span>
              <span className="tabular-nums">
                {monthly == null ? "—" : `${nfGBP.format(monthly)}/month`}
              </span>
            </div>

            {computing && <div className="mt-2 text-xs text-gray-500">Computing preview…</div>}

            {!computing && areaKm2 === 0 && (
              <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                None of your drawn area is purchasable for this slot. Try adjusting your polygon.
              </div>
            )}

            {wasClipped && !computing && hasPurchasableRegion && (
              <div className="mt-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
                Preview shows only the purchasable sub-region on the map.
              </div>
            )}
          </div>

          {!computing && hasPurchasableRegion && (
            <input
              type="text"
              className="mt-2 w-full rounded border border-gray-200 px-3 py-2 text-sm"
              readOnly
              value={priceLine}
              aria-label="Price summary"
            />
          )}
        </div>

        <div className="px-4 py-3 border-t flex justify-end gap-2">
          <button className="btn" onClick={handleClose} disabled={checkingOut}>
            Cancel
          </button>
          <button
            className="btn btn-primary disabled:opacity-50"
            onClick={handleCheckout}
            disabled={checkingOut || computing || !hasPurchasableRegion}
            title={
              computing
                ? "Please wait for the preview"
                : !hasPurchasableRegion
                ? "No purchasable area in your selection"
                : undefined
            }
          >
            {checkingOut ? "Starting checkout…" : "Continue to checkout"}
          </button>
        </div>
      </div>
    </div>
  );
}
