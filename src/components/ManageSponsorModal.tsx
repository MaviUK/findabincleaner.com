import React, { useEffect, useMemo, useState } from "react";

type Slot = 1;

type Props = {
  open: boolean;
  onClose: () => void;

  // ownership context
  businessId: string;
  categoryId: string; // required (industry specific)
  areaId: string;
  slot?: Slot;

  areaName?: string;

  // from area-sponsorship function
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null; // ISO
  priceMonthlyPennies: number | null;
  currency?: string | null;

  // optional: on cancel success
  onCanceled?: () => void;
};

const GBP = (pennies: number | null | undefined) => {
  if (typeof pennies !== "number" || !Number.isFinite(pennies)) return "—";
  return `£${(pennies / 100).toFixed(2)}`;
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function ManageSponsorModal({
  open,
  onClose,
  businessId,
  categoryId,
  areaId,
  slot = 1,
  areaName,
  stripeSubscriptionId,
  currentPeriodEnd,
  priceMonthlyPennies,
  onCanceled,
}: Props) {
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    totalKm2: number | null;
    availableKm2: number | null;
    soldOut: boolean;
    reason?: string;
  } | null>(null);

  // We use the SAME remaining preview RPC endpoint the Sponsor modal uses
  // but here it’s mainly to show “coverage + what’s left” inside their polygon for this industry.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!open) return;

      setLoadingPreview(true);
      setPreviewErr(null);

      try {
        const res = await fetch("/.netlify/functions/sponsored-preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId,
            areaId,
            slot,
            categoryId,
          }),
        });

        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.ok) {
          throw new Error(j?.error || j?.message || "Preview failed");
        }

        if (cancelled) return;

        setPreview({
          totalKm2: typeof j.total_km2 === "number" ? j.total_km2 : null,
          availableKm2: typeof j.available_km2 === "number" ? j.available_km2 : null,
          soldOut: Boolean(j.sold_out),
          reason: j.reason,
        });
      } catch (e: any) {
        if (cancelled) return;
        setPreviewErr(e?.message || "Preview failed");
        setPreview(null);
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [open, businessId, areaId, slot, categoryId]);

  const coverageLabel = useMemo(() => {
    if (!preview?.totalKm2 || preview.totalKm2 <= 0) return "—";
    // for manage we show “how much is NOT available anymore” is confusing
    // instead: show how big their polygon is, and renewal/cost is the key.
    return `${preview.totalKm2.toFixed(3)} km²`;
  }, [preview]);

  const [canceling, setCanceling] = useState(false);
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const [cancelOk, setCancelOk] = useState<string | null>(null);

  const canCancel = Boolean(stripeSubscriptionId) && !canceling;

  const doCancel = async () => {
    if (!stripeSubscriptionId) return;

    setCanceling(true);
    setCancelErr(null);
    setCancelOk(null);

    try {
      const res = await fetch("/.netlify/functions/sponsored-cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId,
          categoryId,
          areaId,
          slot,
          stripeSubscriptionId,
        }),
      });

      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        throw new Error(j?.error || j?.message || "Cancel failed");
      }

      setCancelOk("Subscription canceled. It may take a few seconds to update.");
      onCanceled?.();
    } catch (e: any) {
      setCancelErr(e?.message || "Cancel failed");
    } finally {
      setCanceling(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
      <div className="bg-white w-[720px] max-w-[94vw] rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-semibold">Manage sponsorship — {areaName || "Area"}</div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 text-slate-700 text-sm p-2">
            You already sponsor this area for <b>this industry</b>. Manage billing and renewal below.
          </div>

          {previewErr && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
              {previewErr}
            </div>
          )}

          {cancelErr && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
              {cancelErr}
            </div>
          )}

          {cancelOk && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm p-2">
              {cancelOk}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Monthly price" value={GBP(priceMonthlyPennies)} />
            <Stat label="Renews on" value={fmtDate(currentPeriodEnd)} />
            <Stat label="Your polygon size" value={loadingPreview ? "Loading…" : coverageLabel} />
            <Stat label="Slot" value={`Featured (slot ${slot})`} />
            <Stat label="Stripe subscription" value={stripeSubscriptionId || "—"} />
            <Stat label="Industry" value={categoryId} />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button className="btn" onClick={onClose}>
              Close
            </button>

            <button
              className={`btn ${canCancel ? "btn-danger" : "opacity-60 cursor-default"}`}
              onClick={doCancel}
              disabled={!canCancel}
              title={canCancel ? "Cancel this sponsorship" : ""}
            >
              {canceling ? "Canceling…" : "Cancel sponsorship"}
            </button>
          </div>

          <div className="text-xs text-gray-500">
            Canceling stops renewal. Visibility changes after your current billing period ends (depending on your Stripe settings).
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
      <div className="mt-1 font-semibold break-all">{value}</div>
    </div>
  );
}
