// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

type Slot = 1; // keep as 1 unless you really use multiple tiers

type Props = {
  open: boolean;
  onClose: () => void;

  businessId: string;
  categoryId: string; // ✅ REQUIRED (per-industry sponsorship)
  areaId: string;
  slot?: Slot;

  areaName?: string;

  onPreviewGeoJSON?: (gj: any | null) => void;
  onClearPreview?: () => void;
};

type PreviewState = {
  loading: boolean;
  error: string | null;

  totalKm2: number | null;
  availableKm2: number | null;
  soldOut: boolean;

  ratePerKm2: number | null;
  priceCents: number | null;

  geojson: any | null;
  reason?: string;
};

const EPS = 1e-6;

const GBP = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `£${n.toFixed(2)}` : "—";

const fmtKm2 = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(3)} km²` : "—";

export default function AreaSponsorModal({
  open,
  onClose,
  businessId,
  categoryId,
  areaId,
  slot = 1,
  areaName,
  onPreviewGeoJSON,
  onClearPreview,
}: Props) {
  const [pv, setPv] = useState<PreviewState>({
    loading: false,
    error: null,
    totalKm2: null,
    availableKm2: null,
    soldOut: false,
    ratePerKm2: null,
    priceCents: null,
    geojson: null,
  });

  const monthlyPrice = useMemo(() => {
    if (pv.priceCents == null) return null;
    return pv.priceCents / 100;
  }, [pv.priceCents]);

  // -------------------------
  // Simple draggable modal (no deps)
  // -------------------------
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const startRef = useRef<{ mx: number; my: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    // reset position each time it opens (centered-ish)
    setPos({ x: 0, y: 0 });
  }, [open]);

  const onDragStart = (e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startRef.current = { mx: e.clientX, my: e.clientY, x: pos.x, y: pos.y };
  };

  const onDragMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || !startRef.current) return;
    const dx = e.clientX - startRef.current.mx;
    const dy = e.clientY - startRef.current.my;
    setPos({ x: startRef.current.x + dx, y: startRef.current.y + dy });
  };

  const onDragEnd = (e: React.PointerEvent) => {
    draggingRef.current = false;
    startRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  // -------------------------
  // Preview call (per industry)
  // -------------------------
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!open) return;

      // clear any previous overlay
      onClearPreview?.();
      onPreviewGeoJSON?.(null);

      if (!businessId || !areaId || !categoryId) {
        setPv((s) => ({
          ...s,
          loading: false,
          error: "Missing businessId / areaId / categoryId",
          soldOut: false,
          totalKm2: null,
          availableKm2: null,
          priceCents: null,
          ratePerKm2: null,
          geojson: null,
        }));
        return;
      }

      setPv((s) => ({ ...s, loading: true, error: null }));

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ businessId, areaId, slot, categoryId }),
        });

        const j = await res.json().catch(() => null);

        if (!res.ok || !j?.ok) {
          throw new Error(j?.error || j?.message || "Preview failed");
        }

        const totalKm2 = typeof j.total_km2 === "number" ? j.total_km2 : null;
        const availableKm2 = typeof j.available_km2 === "number" ? j.available_km2 : 0;

        const soldOut =
          Boolean(j.sold_out) || !Number.isFinite(availableKm2) || availableKm2 <= EPS;

        const geojson = soldOut ? null : (j.geojson ?? null);

        if (!cancelled) {
          setPv({
            loading: false,
            error: null,
            soldOut,
            totalKm2,
            availableKm2,
            ratePerKm2: typeof j.rate_per_km2 === "number" ? j.rate_per_km2 : null,
            priceCents: typeof j.price_cents === "number" ? j.price_cents : null,
            geojson,
            reason: j.reason,
          });

          // ✅ IMPORTANT: only ever preview the REMAINING geojson (never fall back to area geom)
          onPreviewGeoJSON?.(geojson);
        }
      } catch (e: any) {
        if (!cancelled) {
          setPv({
            loading: false,
            error: e?.message || "Preview failed",
            soldOut: false,
            totalKm2: null,
            availableKm2: null,
            ratePerKm2: null,
            priceCents: null,
            geojson: null,
          });
          onPreviewGeoJSON?.(null);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // intentionally not depending on onPreviewGeoJSON
  }, [open, businessId, areaId, slot, categoryId]);

  const handleClose = () => {
    onClearPreview?.();
    onPreviewGeoJSON?.(null);
    onClose();
  };

  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutErr, setCheckoutErr] = useState<string | null>(null);

  const hasArea = (pv.availableKm2 ?? 0) > EPS;
  const canBuy = open && hasArea && !checkingOut && !pv.loading && !pv.soldOut;

  const startCheckout = async () => {
    if (!canBuy) return;

    setCheckingOut(true);
    setCheckoutErr(null);

    try {
      const res = await fetch("/.netlify/functions/sponsored-checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId, areaId, slot, categoryId }),
      });

      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.ok) {
        const message =
          j?.message ||
          j?.error ||
          (res.status === 409
            ? "No purchasable area left for this industry in this polygon."
            : `Checkout failed (${res.status})`);

        setCheckoutErr(message);

        if (res.status === 409) {
          setPv((s) => ({ ...s, soldOut: true, availableKm2: 0, geojson: null }));
          onPreviewGeoJSON?.(null);
        }

        setCheckingOut(false);
        return;
      }

      const url = j?.checkout_url as string | undefined;

if (!url) {
  console.error("Checkout response missing checkout_url", j);
  throw new Error("Stripe did not return a checkout URL.");
}

// full page redirect to Stripe
window.location.assign(url);

    } catch (e: any) {
      setCheckoutErr(e?.message || "Checkout failed");
      setCheckingOut(false);
    }
  };

  if (!open) return null;

  let coverageLabel = "—";
  if (pv.totalKm2 && pv.totalKm2 > EPS && pv.availableKm2 != null) {
    const pct = (pv.availableKm2 / pv.totalKm2) * 100;
    coverageLabel = `${pct.toFixed(1)}% of your polygon`;
  }

  return (
    <div className="fixed inset-0 z-[10000] bg-black/40">
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`,
        }}
      >
        <div className="bg-white w-[640px] max-w-[92vw] rounded-xl shadow-xl overflow-hidden">
          {/* DRAG BAR */}
          <div
            className="flex items-start justify-between px-4 py-3 border-b cursor-move select-none"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <div>
              <div className="font-semibold">Sponsor — {areaName || "Area"}</div>
              <div className="text-xs text-gray-500">Drag this bar to move the window</div>
            </div>

            <button className="btn" onClick={handleClose}>
              Close
            </button>
          </div>

          <div className="p-4 space-y-3">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm p-2">
              Featured sponsorship makes you first in local search results. Preview highlights the
              purchasable sub-region (for this industry only).
            </div>

            {/* tiny debug line */}
            <div className="text-[11px] text-gray-500">
              Debug: areaId={areaId} • categoryId={categoryId}
            </div>

            {pv.loading && (
              <div className="rounded-md border border-gray-200 bg-gray-50 text-gray-700 text-sm p-2">
                Computing preview…
              </div>
            )}

            {pv.error && (
              <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
                {pv.error}
              </div>
            )}

            {checkoutErr && (
              <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
                {checkoutErr}
              </div>
            )}

            {pv.soldOut && !hasArea && (
              <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
                No purchasable area left for this industry in this polygon.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total area" value={fmtKm2(pv.totalKm2)} />
              <Stat label="Available area" value={fmtKm2(pv.availableKm2)} />
              <Stat
                label="Price per km² / month"
                hint="From server"
                value={GBP(pv.ratePerKm2 ?? null)}
              />
              <Stat label="Minimum monthly" hint="Floor price" value="£1.00" />
              <Stat label="Your monthly price" value={GBP(monthlyPrice)} />
              <Stat label="Coverage" value={coverageLabel} />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button className="btn" onClick={handleClose}>
                Cancel
              </button>
              <button
                className={`btn ${canBuy ? "btn-primary" : "opacity-60 cursor-default"}`}
                onClick={startCheckout}
                disabled={!canBuy}
                title={canBuy ? "Buy now" : ""}
              >
                {checkingOut ? "Redirecting..." : "Buy now"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
      {hint && <div className="text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
}
