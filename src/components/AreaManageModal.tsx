// src/components/AreaManageModal.tsx
import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** cleaners.id (your “business id”) */
  cleanerId: string;
  areaId: string;
  slot: 1 | 2 | 3;
};

type GetSubOk = {
  ok: true;
  subscription: {
    area_name: string | null;
    status: string | null;
    current_period_end: string | null;
    price_monthly_pennies: number | null;
    cancel_at_period_end?: boolean | null;
  };
};

type GetSubErr = {
  ok: false;
  error?: string;
  notFound?: boolean;
};

type GetSubResp = GetSubOk | GetSubErr;

export default function AreaManageModal({ open, onClose, cleanerId, areaId, slot }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sub, setSub] = useState<GetSubOk["subscription"] | null>(null);

  const title = useMemo(() => `Manage Slot #${slot}`, [slot]);

  async function load() {
    if (!open) return;

    setLoading(true);
    setErr(null);
    setNotice(null);
    setSub(null);

    try {
      const res = await fetch("/.netlify/functions/subscription-get", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId: cleanerId,
          areaId,
          slot,
        }),
      });

      const json: GetSubResp = await res.json();

      if ("ok" in json && json.ok) {
        setSub(json.subscription);
      } else if ("notFound" in json && json.notFound) {
        setErr("No active subscription was found for this slot.");
      } else {
        setErr(("error" in json && json.error) || "Failed to load subscription.");
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load subscription.");
    } finally {
      setLoading(false);
    }
  }

  // Load current subscription
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!open) return;
      await load();
      if (cancelled) return;
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cleanerId, areaId, slot]);

  const cancelAtPeriodEnd = Boolean(sub?.cancel_at_period_end);
  const nextRenewalLabel = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleString()
    : "—";

  async function toggleCancel() {
    if (!sub) return;

    setLoading(true);
    setErr(null);
    setNotice(null);

    try {
      const action = cancelAtPeriodEnd ? "reactivate" : "cancel";

      const res = await fetch("/.netlify/functions/subscription-cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId: cleanerId,
          areaId,
          slot,
          action, // ✅ NEW
        }),
      });

      const json: { ok?: boolean; error?: string; cancel_at_period_end?: boolean } =
        await res.json().catch(() => ({}));

      if (!json?.ok) throw new Error(json?.error || "Update failed");

      // ✅ In-modal confirmation (no missing alert)
      setNotice(
        action === "cancel"
          ? "Cancelled at period end. You will keep sponsorship until the end of the current billing period."
          : "Sponsorship reactivated. Your subscription will renew as normal."
      );

      // Refresh displayed state
      await load();
    } catch (e: any) {
      setErr(e?.message || "Update failed");
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
          <button className="text-sm opacity-70 hover:opacity-100" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}

          {notice && (
            <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded p-2">
              {notice}
            </div>
          )}

          {loading && <div className="text-sm text-gray-600">Loading…</div>}

          {!loading && sub && (
            <div className="text-sm space-y-1">
              <div>
                <span className="font-medium">Area:</span> {sub.area_name || "—"}
              </div>
              <div>
                <span className="font-medium">Status:</span>{" "}
                {cancelAtPeriodEnd ? "canceling (at period end)" : sub.status || "unknown"}
              </div>
              <div>
                <span className="font-medium">Next renewal:</span> {nextRenewalLabel}
              </div>
              <div>
                <span className="font-medium">Price:</span>{" "}
                {typeof sub.price_monthly_pennies === "number"
                  ? `${(sub.price_monthly_pennies / 100).toFixed(2)} GBP/mo`
                  : "—"}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          {sub && (
            <button className="btn" onClick={toggleCancel} disabled={loading}>
              {cancelAtPeriodEnd ? "Keep sponsorship (reactivate)" : "Cancel at period end"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
