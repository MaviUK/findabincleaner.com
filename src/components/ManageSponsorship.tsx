// src/components/ManageSponsorship.tsx
import React from "react";

type Props = {
  businessId: string;   // cleaner/business UUID
  areaId: string;       // area UUID
  slot: number;         // 1, 2, or 3
};

type SubData = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  price: number | null;
  currency: string | null;
};

export default function ManageSponsorship({ businessId, areaId, slot }: Props) {
  const [loading, setLoading] = React.useState(true);
  const [sub, setSub] = React.useState<SubData | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ business_id: businessId, area_id: areaId, slot: String(slot) });
      const res = await fetch(`/api/subscription/get?${qs}`, { method: "GET" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load");
      setSub(json.subscription || null);
    } catch (e: any) {
      setErr(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [businessId, areaId, slot]);

  React.useEffect(() => { load(); }, [load]);

  const cancelAtPeriodEnd = async () => {
    if (!sub?.id) return;
    if (!confirm("Cancel at the end of the current period?")) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/subscription/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stripe_subscription_id: sub.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Cancel failed");
      setSub(json.subscription);
    } catch (e: any) {
      setErr(e.message || "Cancel failed");
    } finally {
      setBusy(false);
    }
  };

  const openBillingPortal = async () => {
    // you already have netlify/functions/billing-portal.js wired at /api/billing/portal
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const json = await res.json();
    if (json?.url) window.location.href = json.url;
  };

  if (loading) return <div>Loading subscription…</div>;
  if (err) return <div className="text-red-600">Error: {err}</div>;
  if (!sub) {
    return (
      <div>
        <p>No active subscription found for this area/slot.</p>
        {/* (Fallback) show your “Purchase” button here if needed */}
      </div>
    );
  }

  const nextRenewal = sub.current_period_end ? new Date(sub.current_period_end).toLocaleString() : "—";
  const price = sub.price != null ? (sub.price / 100).toFixed(2) : "—";
  const currency = (sub.currency || "gbp").toUpperCase();

  return (
    <div className="space-y-3">
      <div><strong>Status:</strong> {sub.status}{sub.cancel_at_period_end ? " (cancels at period end)" : ""}</div>
      <div><strong>Price:</strong> {price} {currency} / month</div>
      <div><strong>Next renewal:</strong> {nextRenewal}</div>

      <div className="flex gap-8 mt-3">
        {!sub.cancel_at_period_end && (
          <button
            disabled={busy}
            onClick={cancelAtPeriodEnd}
            className="px-4 py-2 rounded bg-amber-500 text-white disabled:opacity-50"
          >
            {busy ? "Cancelling…" : "Cancel at period end"}
          </button>
        )}

        <button
          onClick={openBillingPortal}
          className="px-4 py-2 rounded border"
        >
          Open Billing Portal
        </button>
      </div>
    </div>
  );
}
