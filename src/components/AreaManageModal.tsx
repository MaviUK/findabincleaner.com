import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  areaId: string;
  slot: 1 | 2 | 3;
};

// Shape returned by /.netlify/functions/subscription-get
type SubView = {
  area_name?: string | null;
  status: string;
  next_renewal_iso?: string | null;
  price_monthly_pennies?: number | null;
  currency?: string | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
};

export default function AreaManageModal({ open, onClose, areaId, slot }: Props) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<SubView | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch("/.netlify/functions/subscription-get", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ areaId, slot }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
        setView(json as SubView);
      } catch (e: any) {
        setErr(e?.message || "Failed to load subscription.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, areaId, slot]);

  async function cancelAtPeriodEnd() {
    if (!confirm("Cancel at the end of the current billing period?")) return;
    try {
      setWorking(true);
      const res = await fetch("/.netlify/functions/subscription-cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ areaId, slot }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      // reflect new status locally
      setView((v) => (v ? { ...v, status: json.status || "canceled" } : v));
    } catch (e: any) {
      alert(e?.message || "Cancel failed");
    } finally {
      setWorking(false);
    }
  }

  const price =
    view?.price_monthly_pennies != null
      ? `${(view.price_monthly_pennies / 100).toFixed(2)} ${(view.currency || "gbp").toUpperCase()}/mo`
      : null;

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      {/* Centered card — matches the look of AreaSponsorModal */}
      <div className="absolute inset-0 flex items-center justify-center px-4">
        <div
          className={`w-full max-w-xl rounded-xl bg-white shadow-xl transition-transform ${
            open ? "scale-100" : "scale-95"
          }`}
        >
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <div className="font-semibold">
              {view?.area_name ? `Manage ${view.area_name} — Slot #${slot}` : `Manage Slot #${slot}`}
            </div>
            <button className="text-sm opacity-70 hover:opacity-100" onClick={onClose}>
              Close
            </button>
          </div>

          <div className="px-5 py-4 space-y-3">
            {loading && <div>Loading…</div>}
            {err && <div className="text-red-600">{err}</div>}

            {!loading && !err && view && (
              <>
                <div className="text-sm">
                  <div>
                    <span className="font-medium">Status:</span> {view.status}
                  </div>
                  {view.next_renewal_iso && (
                    <div>
                      <span className="font-medium">Next renewal:</span>{" "}
                      {new Date(view.next_renewal_iso).toLocaleString()}
                    </div>
                  )}
                  {price && (
                    <div>
                      <span className="font-medium">Price:</span> {price}
                    </div>
                  )}
                </div>

                {(view.hosted_invoice_url || view.invoice_pdf) && (
                  <div className="text-sm">
                    <div className="font-medium mb-1">Latest invoice</div>
                    <div className="flex gap-3">
                      {view.hosted_invoice_url && (
                        <a className="underline" href={view.hosted_invoice_url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      )}
                      {view.invoice_pdf && (
                        <a className="underline" href={view.invoice_pdf} target="_blank" rel="noreferrer">
                          PDF
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div className="pt-1">
                  <button
                    className="btn"
                    onClick={cancelAtPeriodEnd}
                    disabled={working || view.status === "canceled"}
                  >
                    {working ? "Cancelling…" : "Cancel at period end"}
                  </button>
                </div>

                <p className="text-xs text-gray-500">
                  To update payment method or billing details, use <span className="font-medium">Manage billing</span> at
                  the top of the dashboard.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
