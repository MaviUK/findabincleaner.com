export type PaymentKey =
  | "bank_transfer"
  | "cash"
  | "stripe"
  | "gocardless"
  | "paypal"
  | "card_machine";

export const PAYMENT_METHODS: { key: PaymentKey; label: string; iconUrl: string }[] = [
  { key: "bank_transfer", label: "Bank Transfer", iconUrl: "/payment-icons/bank_transfer.svg" },
  { key: "cash",          label: "Cash",          iconUrl: "/payment-icons/cash.svg" },
  { key: "stripe",        label: "Stripe",        iconUrl: "/payment-icons/stripe.svg" },
  { key: "gocardless",    label: "GoCardless",    iconUrl: "/payment-icons/gocardless.svg" },
  { key: "paypal",        label: "PayPal",        iconUrl: "/payment-icons/paypal.svg" },
  { key: "card_machine",  label: "Card Machine",  iconUrl: "/payment-icons/card_machine.svg" },
];

// quick helpers
export const PM_ICON: Record<PaymentKey, string> = Object.fromEntries(
  PAYMENT_METHODS.map(m => [m.key, m.iconUrl])
) as Record<PaymentKey, string>;

export const PM_LABEL: Record<PaymentKey, string> = Object.fromEntries(
  PAYMENT_METHODS.map(m => [m.key, m.label])
) as Record<PaymentKey, string>;
