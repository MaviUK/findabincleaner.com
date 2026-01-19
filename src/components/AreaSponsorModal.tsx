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

  const monthlyPrice = useMemo(
    () => (pv.priceCents != null ? pv.priceCents / 100 : null),
    [pv.priceCents]
  );

  // ─────────────────────────
  // Drag handling
  // ─────────────────────────
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const startRef = useRef<{ mx: number; my: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (open) setPos({ x: 0, y: 0 });
  }, [open]);

  const onDragStart = (e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startRef.current = { mx: e.clientX, my: e.clientY, x: pos.x, y: pos.y };
  };

  const onDragMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || !startRef.current) return;
    setPos({
      x: startRef.current.x + (e.clientX - startRef.current.mx),
      y: startRef.current.y + (e.clientY - startRef.current.my),
    });
  };

  const onDragEnd = (e: React.PointerEvent) => {
    draggingRef.current = false;
    startRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  // ─────────────────────────
  // Preview fetch (FIXED)
  // ─────────────────────────
  useEffect(() => {
    if (!open) return;

    const ac = new AbortController();
    const timeout = window.setTimeout(() => ac.abort(), 12000);

    onClearPreview?.();
    onPreviewGeoJSON?.(null);

    if (!businessId || !areaId || !categoryId) {
      setPv({
        loading: false,
        error: "Missing businessId / areaId / categoryId",
        totalKm2: null,
        availableKm2: null,
        soldOut: false,
        ratePerKm2: null,
        priceCents: null,
        geojson: null,
      });
      return;
    }

    setPv({
      loading: true,
      error: null,
      totalKm2: null,
      availableKm2: null,
      soldOut: false,
      ratePerKm2: null,
      priceCents: null,
      geojson: null,
    });

    (async () => {
      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ businessId, areaId, slot, categoryId }),
          signal: ac.signal,
        });

        const j = await res.json().catch(() => null);

        if (!res.ok || !j?.ok) {
          throw new Error(j?.error || j?.message || `Preview failed (${res.status})`);
        }

        const totalKm2 = typeof j.total_km2 === "number" ? j.total_km2 : null;
        const availableKm2 = typeof j.available_km2 === "number" ? j.available_km2 : 0;
        const soldOut = Boolean(j.sold_out) || availableKm2 <= EPS;
        const geojson = soldOut ? null : j.geojson ?? null;

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

        onPreviewGeoJSON?.(geojson);
      } catch (e: any) {
        setPv({
          loading: false,
          error:
            e?.name === "AbortError"
              ? "Preview timed out. Please try again."
              : e?.message || "Preview failed",
          soldOut: false,
          totalKm2: null,
          availableKm2: null,
          ratePerKm2: null,
          priceCents: null,
          geojson: null,
        });
        onPreviewGeoJSON?.(null);
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => {
      window.clearTimeout(timeout);
      ac.abort();
    };
  }, [open, businessId, areaId, slot, categoryId, onPreviewGeoJSON, onClearPreview]);

  // ─────────────────────────
  // Checkout
  // ─────────────────────────
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
        setCheckoutErr(j?.error || j?.message || "Checkout failed");
        setCheckingOut(false);
        return;
      }

      if (!j.checkout_url) throw new Error("Stripe did not return a checkout URL");
      window.location.assign(j.checkout_url);
    } catch (e: any) {
      setCheckoutErr(e?.message || "Checkout failed");
      setCheckingOut(false);
    }
  };

  if (!open) return null;

  let coverageLabel = "—";
  if (pv.totalKm2 && pv.availableKm2 != null && pv.totalKm2 > EPS) {
    coverageLabel = `${((pv.availableKm2 / pv.totalKm2) * 100).toFixed(1)}% of your polygon`;
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
        <div className="rounded-xl bg-white shadow-xl border border-amber-200 overflow-hidden">
          {/* Header */}
          <div
            className="px-4 py-3 border-b bg-amber-50 cursor-move select-none flex justify-between"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
          >
            <div>
              <div className="font-semibold text-amber-900">Sponsor — {areaName || "Area"}</div>
              <div className="text-xs text-amber-800/70">Drag this bar to move the window</div>
            </div>
            <button className="text-sm opacity-70 hover:opacity-100" onClick={onClose}>
              Close
            </button>
          </div>

          <div className="px-4 py-4 space-y-3">
            {pv.loading && (
              <div className="text-sm bg-gray-50 border rounded p-3">Computing preview…</div>
            )}
            {pv.error && (
              <div className="text-sm bg-red-50 border border-red-200 rounded p-3">{pv.error}</div>
            )}
            {checkoutErr && (
              <div className="text-sm bg-red-50 border border-red-200 rounded p-3">{checkoutErr}</div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total area" value={fmtKm2(pv.totalKm2)} />
              <Stat label="Available area" value={fmtKm2(pv.availableKm2)} />
              <Stat label="Price per km² / month" value={GBP(pv.ratePerKm2)} />
              <Stat label="Minimum monthly" value="£1.00" />
              <Stat label="Your monthly price" value={GBP(monthlyPrice)} />
              <Stat label="Coverage" value={coverageLabel} />
            </div>
          </div>

          <div className="px-4 py-3 border-t flex justify-end gap-2">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button
              className={`btn ${canBuy ? "btn-primary" : "opacity-60 cursor-default"}`}
              onClick={startCheckout}
              disabled={!canBuy}
            >
              {checkingOut ? "Redirecting…" : "Buy now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}
