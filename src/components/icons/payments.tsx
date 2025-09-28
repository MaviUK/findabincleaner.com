// src/components/icons/payments.tsx
export const PAYMENT_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  gocardless: "GoCardless",
  paypal: "PayPal",
  cash: "Cash",
  stripe: "Stripe",
  card_machine: "Card Machine",
};

// served from /public
const FILES: Record<string, string> = {
  bank_transfer: "/payment-icons/bank_transfer.svg",
  card_machine:  "/payment-icons/card_machine.svg",
  cash:          "/payment-icons/cash.svg",
  gocardless:    "/payment-icons/gocardless.svg",
  paypal:        "/payment-icons/paypal.svg",
  stripe:        "/payment-icons/stripe.svg",
};

export function PaymentPill({ kind }: { kind: string }) {
  const label = PAYMENT_LABELS[kind] ?? kind;
  const src = FILES[kind] ?? "/payment-icons/stripe.svg";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/5 text-night-800 px-2.5 py-1 text-xs ring-1 ring-black/10">
      <img src={src} alt="" className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
