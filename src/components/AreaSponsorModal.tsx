// src/components/AreaSponsorModal.tsx
import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  cleanerId: string;
  areaId: string;
  slot: 1 | 2 | 3;
};

type GetSubResponse =
  | {
      ok: true;
      subscription: {
        area_name: string | null;
        status: string | null;
        current_period_end: string | null; // ISO
        price_monthly_pennies: number | null;
      };
    }
  | { ok: false; notFound?: boolean; error?: string };

export default function AreaSponsorModal({
  open,
  onClose,
  cleanerId,
  areaId,
  slot,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"manage" | "sponsor" | "error">("sponsor");
  const [areaName, setAreaName] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [priceGBP, setPriceGBP] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const title = useMemo(
    () => (mode === "manage" ? `Manage Slot #${slot}` : `Sponsor #${slot}`),
    [mode, slot]
  );

  useEffect(() => {
    if (!open) return;

    // Sanity check props
    if (!cleanerId || !areaId || !slot) {
      setMode("error");
      setErr("Missing params");
      setLoading(false);
      return;
    }

    // Try to load an existing subscription for this cleaner/area/slot
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch("/.netlify/functions/subscription-get", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cleanerId, areaId, slot }),
        });
        const json: GetSubResponse = await res.json();

        if (json.ok) {
          setMode("manage");
          const s = json.subscription;
          setAreaName(s.area_name || "");
          setStatus(s.status || null);
          setPeriodEnd(s.current_period_end);
          setPriceGBP(
            typeof s.price_monthly_pennies === "number"
              ? (s.price_monthly_pennies / 100).toFixed(2)
              : null
          );
        } else if (json.notFound) {
          // No sub found for this cleaner/area/slot → sponsor mode
          setMode("sponsor");
          // Optional: you can also fetch a price preview here if you want.
        } else {
          setMode("error");
          setErr(json.error || "Failed to load subscription");
        }
      } catch (e: any) {
        setMode("error");
        setErr(e?.message || "Failed to load subscription");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, cleanerId, areaId, slot]);

  async function cancelAtPeriodEnd() {
    if (!confirm("Cancel this subscription at period end?")) return;
    try {
      setLoading(true);
      const res = await fetch("/.netlify/functions/subscription-cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cleanerId, areaId, slot }),
      });
      const json = await res.json();
      if (!res.ok || json?.ok !== true) {
        throw new Error(json?.error || `Cancel failed (${res.status})`);
      }
      // Update UI to reflect canceled status
      setStatus("canceled");
    } catch (e: any) {
      setErr(e?.message || "Cancel failed");
    } finally {
      setLoading(false);
    }
  }

  function sponsorCheckout() {
    // Hand off to your existing checkout function endpoint
    // This endpoint looks up availability and creates a Stripe Checkout Session.
    const url = "/.netlify/functions/sponsored-checkout";
    setLoading(true);
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cleanerId, areaId, slot }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.url) {
          window.location.href = j.url;
        } else {
          throw new Error(j?.error || "Failed to start checkout");
        }
      })
      .catch((e) => {
        setErr(e?.message || "Failed to start checkout");
        setLoading(false);
      });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !loading && onClose()}
      />

      {/* Modal */}
      <div className="relative z-[101] w-[92vw] max-w-md rounded-xl bg-white shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="font-semibold">{title}</div>
          <button className="text-sm opacity-70 hover:opacity-100" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          {loading && <div className="text-sm text-gray-600">Loading…</div>}

          {!loading && err && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}

          {!loading && mode === "manage" && !err && (
            <>
              {areaName && (
                <div className="text-sm">
                  <span className="font-medium">Area:</span> {areaName}
                </div>
              )}
              <div className="text-sm">
                <span className="font-medium">Status:</span> {status || "—"}
              </div>
              <div className="text-sm">
                <span className="font-medium">Next renewal:</span>{" "}
                {periodEnd ? new Date(periodEnd).toLocaleString() : "—"}
              </div>
              <div className="text-sm">
                <span className="font-medium">Price:</span>{" "}
                {priceGBP ? `${priceGBP} GBP/mo` : "—"}
              </div>

              <div className="pt-1">
                <button
                  className="btn"
                  onClick={cancelAtPeriodEnd}
                  disabled={loading || status === "canceled"}
                >
                  Cancel at period end
                </button>
              </div>
            </>
          )}

          {!loading && mode === "sponsor" && !err && (
            <>
              <div className="text-sm text-gray-700">
                This slot appears to be available. Continue to checkout to sponsor it.
              </div>
              <div className="pt-1">
                <button className="btn btn-primary" onClick={sponsorCheckout} disabled={loading}>
                  Continue to checkout
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
