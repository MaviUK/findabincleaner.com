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
  };
};

type GetSubErr = {
  ok: false;
  error?: string;
  notFound?: boolean;
};

type GetSubResp = GetSubOk | GetSubErr;

export default function AreaManageModal({
  open,
  onClose,
  cleanerId,
  areaId,
  slot,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sub, setSub] = useState<GetSubOk["subscription"] | null>(null);

  const [infoOpen, setInfoOpen] = useState(false);
  const [infoMsg, setInfoMsg] = useState("");

  const title = useMemo(() => `Manage Slot #${slot}`, [slot]);

  // Load current subscription for this business/area/slot
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!open) return;
      setLoading(true);
      setErr(null);
      setSub(null);
      try {
        const res = await fetch("/.netlify/functions/subscription-get", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            businessId: cleanerId,  // IMPORTANT
            areaId,
            slot,
          }),
        });
        const json: GetSubResp = await res.json();

        if (cancelled) return;

        if ("ok" in json && json.ok) {
          setSub(json.subscription);
        } else if ("notFound" in json && json.notFound) {
          setErr("No active subscription was found for this slot.");
        } else {
          setErr(("error" in json && json.error) || "Failed to load subscription.");
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load subscription.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [open, cleanerId, areaId, slot]);

  async function cancelAtPeriodEnd() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/.netlify/functions/subscription-cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId: cleanerId,  // IMPORTANT
          areaId,
          slot,
        }),
      });
      const json: { ok?: boolean; error?: string } = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Cancel failed");

      onClose();
setInfoMsg("Your sponsorship will be cancelled at the end of the current period.");
setInfoOpen(true);

    } catch (e: any) {
      setErr(e?.message || "Cancel failed");
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

          {loading && <div className="text-sm text-gray-600">Loading…</div>}

          {!loading && sub && (
            <div className="text-sm space-y-1">
              <div>
                <span className="font-medium">Area:</span> {sub.area_name || "—"}
              </div>
              <div>
                <span className="font-medium">Status:</span> {sub.status || "unknown"}
              </div>
              <div>
                <span className="font-medium">Next renewal:</span>{" "}
                {sub.current_period_end ? new Date(sub.current_period_end).toLocaleString() : "—"}
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
          <button className="btn" onClick={cancelAtPeriodEnd} disabled={loading}>
            Cancel at period end
          </button>
        </div>
      </div>
    </div>
  );
}
