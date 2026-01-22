// src/components/AreaSponsorModal.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

type Slot = 1;

type Props = {
  open: boolean;
  onClose: () => void;

  businessId: string;
  categoryId: string;
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

  // ✅ Keep callback refs stable so preview effect does NOT re-run endlessly
  const onPreviewRef = useRef<typeof onPreviewGeoJSON>();
  const onClearRef = useRef<typeof onClearPreview>();
  useEffect(() => {
    onPreviewRef.current = onPreviewGeoJSON;
  }, [onPreviewGeoJSON]);
  useEffect(() => {
    onClearRef.current = onClearPreview;
  }, [onClearPreview]);

  const monthlyPrice = useMemo(() => {
    if (pv.priceCents == null) return null;
    return pv.priceCents / 100;
  }, [pv.priceCents]);

  // -------------------------
  // Draggable header
  // -------------------------
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const startRef = useRef<{ mx: number; my: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
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
  // Preview call (per industry) - ✅ stable + abort + timeout
  // -------------------------
  useEffect(() => {
    if (!open) return;

    // clear preview immediately when opening
    onClearRef.current?.();
    onPreviewRef.current?.(null);

    // validate inputs
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

    const ac = new AbortController();
    const timeoutMs = 18_000; // ✅ hard timeout so you never “hang”
    const t = window.setTimeout(() => ac.abort(), timeoutMs);

    setPv((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({ businessId, areaId, slot, categoryId }),
        });

        const j = await res.json().catch(() => null);

        if (!res.ok || !j?.ok) {
          throw new Error(j?.error || j?.message || `Preview failed (${res.status})`);
        }

        const totalKm2 = typeof j.total_km2 === "number" ? j.total_km2 : null;
        const availableKm2 = typeof j.available_km2 === "number" ? j.available_km2 : 0;

        const soldOut =
          Boolean(j.sold_out) || !Number.isFinite(availableKm2) || availableKm2 <= EPS;

        const geojson = soldOut ? null : (j.geojson ?? null);

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

        onPreviewRef.current?.(geojson);
      } catch (e: any) {
        const aborted = String(e?.name || "").toLowerCase() === "aborterror";
        setPv({
          loading: false,
          error: aborted ? "Preview timed out. Please try again." : (e?.message || "Preview failed"),
          soldOut: false,
          totalKm2: null,
          availableKm2: null,
          ratePerKm2: null,
          priceCents: null,
          geojson: null,
        });
        onPreviewRef.current?.(null);
      } finally {
        window.clearTimeout(t);
      }
    })();

    // cleanup
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [open, businessId, areaId, slot, categoryId]);

  const handleClose = () => {
    onClearRef.current?.();
    onPreviewRef.current?.(null);
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
          onPreviewRef.current?.(null);
        }

        setCheckingOut(false);
        return;
      }

      const url = j?.checkout_url as string | undefined;
      if (!url) throw new Error("Stripe did not return a checkout URL.");

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
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30 p-4">
      <div
        className="w-full max-w-2xl"
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        <div className="w-full rounded-xl bg-white shadow-xl border border-amber-200 overflow-hidden">
          {/* Header (drag) */}
          <div
            className="px-4 py-3 border-b border-amber-200 flex items-center justify-between bg-amber-50 rounded-t-xl cursor-move select-none"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <div>
              <div className="font-semibold text-amber-900">
                Sponsor — {areaName || "Area"}
              </div>
              <div className="text-xs text-amber-800/70">Drag this bar to move the window</div>
            </div>

            <button
  type="button"
  className="text-sm opacity-70 hover:opacity-100"
  onPointerDown={(e) => {
    // stop the drag bar from capturing the pointer
    e.stopPropagation();
  }}
  onClick={(e) => {
    e.stopPropagation();
    handleClose();
  }}
  disabled={checkingOut}
>
  Close
</button>

          </div>

          <div className="px-4 py-4 space-y-3">
            <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded p-3">
              <div className="font-semibold mb-1">Featured sponsorship</div>
              <div>
                Featured sponsorship makes you first in local search results. Preview highlights the
                purchasable sub-region (for this industry only).
              </div>
            </div>

            <div className="text-[11px] text-gray-500">
              Debug: areaId={areaId} • categoryId={categoryId}
            </div>

            {pv.loading && (
              <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded p-3">
                Computing preview…
              </div>
            )}

            {pv.error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
                {pv.error}
              </div>
            )}

            {checkoutErr && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
                {checkoutErr}
              </div>
            )}

            {pv.soldOut && !hasArea && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
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
          </div>

          <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
            <button className="btn" onClick={handleClose} disabled={checkingOut}>
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
