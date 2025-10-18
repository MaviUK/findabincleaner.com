// ManageModal.tsx (React)
type ManageModalProps = {
  areaName: string;
  slot: number;
  sub: {
    stripe_subscription_id: string;
    status: string;
    current_period_end: string | null;
    price_monthly_pennies: number | null;
    currency: string | null;
  };
  invoice?: { hosted_invoice_url?: string | null; invoice_pdf?: string | null } | null;
  business_id: string;
  area_id: string;
  onClose: () => void;
  onCanceled: () => void; // e.g., refresh page state
};

export function ManageModal(props: ManageModalProps) {
  const {
    areaName, slot, sub, invoice, business_id, area_id, onClose, onCanceled
  } = props;

  async function cancelAtPeriodEnd() {
    const res = await fetch("/api/subscription/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ business_id, area_id, slot }),
    });
    if (res.ok) {
      onCanceled();
    } else {
      const j = await res.json().catch(() => ({}));
      alert(j?.error || "Failed to set cancel at period end");
    }
  }

  const price = sub.price_monthly_pennies != null
    ? `${(sub.price_monthly_pennies / 100).toFixed(2)} ${(sub.currency || "gbp").toUpperCase()}`
    : "-";

  const renew = sub.current_period_end
    ? new Date(sub.current_period_end).toLocaleString()
    : "—";

  return (
    <div className="modal">
      <h3>{`Manage Sponsor #${slot} — ${areaName}`}</h3>

      <div className="row">
        <div><strong>Status:</strong> {sub.status}</div>
        <div><strong>Next renewal:</strong> {renew}</div>
        <div><strong>Price:</strong> {price}/mo</div>
      </div>

      {invoice?.hosted_invoice_url && (
        <p>
          Latest invoice:{" "}
          <a target="_blank" rel="noreferrer" href={invoice.hosted_invoice_url}>
            view invoice
          </a>
        </p>
      )}

      <div className="actions">
        <button onClick={cancelAtPeriodEnd}>
          Cancel at period end
        </button>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
