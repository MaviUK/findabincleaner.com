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

type Subscription = {
  area_name: string | null;
  status: string | null;
  current_period_end: string | null;
  price_monthly_pennies: number | null;
  cancel_at_period_end?: boolean | null; // ✅ NEW
};

type GetSubOk = {
  ok: true;
  subscription: Subscription;
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
  const [sub, setSub] = useState<Subscription | null>(null);

  const title = useMemo(() => `Manage Slot #${slot}`, [slot]);

  async function load() {
    setLoading(true);
    setErr(null);
    setNotice(null);

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
        setSub(null);
        setErr("No active subscription was found for this slot.");
      } else {
        setSub(null);
        setErr(("error" in json && json.error) || "Failed to load subscription.");
      }
    } catch (e: any) {
      setSub(null);
      setErr(e?.message || "Failed to load subscription.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cleanerId, areaId, slot]);

  const isCanceling =
    Boolean(sub?.cancel_at_period_end) ||
    (String(sub?.status || "").toLowerCase() === "canceled" ? true : false);

  async function setCancelMode(mode: "cancel_at_period_end" | "reactivate") {
    setLoading(true);
    setErr(null);
    setNotice(null);

    try {
      const res = await fetch("/.netlify/functions/subscription-cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          businessId: cleanerId,
          areaId,
          slot,
          mode, // ✅ NEW: server decides cancel vs reactivate
        }),
      });

      const json: { ok?: boolean; error?: string } = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Request failed");

      // ✅ In-modal confirmation (no alert)
      if (mode === "cancel_at_period_end") {
        setNotice("Your sponsorship will be cancelled at the end of the current period.");
      } else {
        setNotice("Your sponsorship has been reactivated and will renew as normal.");
      }

      // reload to reflect updated cancel_at_period_end + status
      await load();
    } catch (e: any) {
      setErr(e?.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-amber-200">
        <div className="px-4 py-3 border-b border-amber-200 flex items-center justify-between bg-amber-50 rounded-t-xl">
          <div className="font-semibold text-amber-900">{title}</div>
          <button
            className="text-sm opacity-70 hover:opacity-100"
            onClick={() => {
              if (loading) return;
              setErr(null);
              setNotice(null);
              onClose();
            }}
            disabled={loading}
          >
            Close
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
              {err}
            </div>
          )}

          {notice && (
            <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded p-3">
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
                <span className="font-medium">Status:</span> {sub.status || "unknown"}
                {sub.cancel_at_period_end ? (
                  <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 border border-amber-200">
                    Cancels at period end
                  </span>
                ) : null}
              </div>
              <div>
                <span className="font-medium">Next renewal:</span>{" "}
                {sub.current_period_end
                  ? new Date(sub.current_period_end).toLocaleString()
                  : "—"}
              </div>
              <div>
                <span className="font-medium">Price:</span>{" "}
                {typeof sub.price_monthly_pennies === "number"
                  ? `£${(sub.price_monthly_pennies / 100).toFixed(2)} / mo`
                  : "—"}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
          {sub && (
            <button
              className={`btn ${loading ? "opacity-60 cursor-not-allowed" : ""}`}
              onClick={() => {
                if (loading) return;
                if (isCanceling) setCancelMode("reactivate");
                else setCancelMode("cancel_at_period_end");
              }}
              disabled={loading}
              title={isCanceling ? "Reactivate auto-renewal" : "Cancel at period end"}
            >
              {isCanceling ? "Reactivate" : "Cancel at period end"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
