import React from "react";
import { Link } from "react-router-dom";

type Cleaner = {
  id: string;
  business_name: string;
  logo_url?: string | null;
  address?: string | null;
  distance_m?: number | null;            // distance in meters
  website?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  rating_avg?: number | null;            // 0–10 like Checkatrade (optional)
  rating_count?: number | null;          // reviews count (optional)
  payment_methods?: string[] | null;     // ["cash","stripe",...]
};

const PM_ICON: Record<string, string> = {
  bank_transfer: "/payment-icons/bank_transfer.svg",
  cash: "/payment-icons/cash.svg",
  stripe: "/payment-icons/stripe.svg",
  gocardless: "/payment-icons/gocardless.svg",
  paypal: "/payment-icons/paypal.svg",
  card_machine: "/payment-icons/card_machine.svg",
};

function CurrencyBadge({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
      <img src={value} alt={label} className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function RatingBadge({ score, count }: { score?: number | null; count?: number | null }) {
  if (!score) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 text-blue-700 px-2 py-1 text-sm font-semibold">
      {score.toFixed(2)}
      {typeof count === "number" && (
        <span className="ml-1 text-xs font-normal text-blue-600">({count} review{count === 1 ? "" : "s"})</span>
      )}
    </span>
  );
}

export default function CleanerCard({
  cleaner,
  postcodeHint,
}: {
  cleaner: Cleaner;
  postcodeHint?: string; // e.g. the postcode the user searched
}) {
  const km = typeof cleaner.distance_m === "number" ? (cleaner.distance_m / 1000).toFixed(1) + " km" : null;

  const payments = (cleaner.payment_methods ?? []).filter((k) => PM_ICON[k]);
  const hasContact = cleaner.phone || cleaner.whatsapp || cleaner.website;

  return (
    <article className="rounded-2xl border bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex gap-4">
        {/* Logo */}
        <div className="shrink-0">
          <div className="h-16 w-16 rounded-xl border bg-white overflow-hidden flex items-center justify-center">
            {cleaner.logo_url ? (
              <img src={cleaner.logo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="text-xs text-gray-400">Logo</div>
            )}
          </div>
        </div>

        {/* Middle content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base sm:text-lg font-semibold truncate">{cleaner.business_name}</h3>
            <RatingBadge score={cleaner.rating_avg} count={cleaner.rating_count} />
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
            {postcodeHint && (
              <span className="inline-flex items-center gap-1">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>
                Operates in {postcodeHint.toUpperCase()}
              </span>
            )}
            {km && <span>• {km} away</span>}
          </div>

          {/* Chips / services (simple defaults for now) */}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-xs rounded-full border px-2 py-1">Wheelie bin cleaning</span>
            <span className="text-xs rounded-full border px-2 py-1">Eco-friendly</span>
            <span className="text-xs rounded-full border px-2 py-1">Domestic & commercial</span>
          </div>

          {/* Payments */}
          {payments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {payments.map((k) => (
                <CurrencyBadge key={k} value={PM_ICON[k]} label={labelFor(k)} />
              ))}
            </div>
          )}
        </div>

        {/* Right CTA column */}
        <div className="shrink-0 flex flex-col items-end justify-between gap-2 w-[180px]">
          <Link
            to={`/cleaner/${cleaner.id}`}
            className="w-full inline-flex justify-center items-center rounded-full bg-[#ff4040] text-white text-sm font-semibold px-4 py-2 hover:brightness-95"
          >
            Request a quote
          </Link>

          {hasContact && (
            <div className="w-full flex flex-col gap-2">
              {cleaner.phone && (
                <a
                  href={`tel:${cleaner.phone}`}
                  className="w-full inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm hover:bg-gray-50"
                >
                  <svg className="h-4 w-4 mr-1.5" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.8-.4 1.1-.2l3.5 1.4c.4.2.7.5.7.9V20c0 1.1-.9 2-2 2C9.6 22 2 14.4 2 5c0-1.1.9-2 2-2h2.7c.4 0 .8.3.9.7l1.4 3.5c.1.4 0 .8-.2 1.1L6.6 10.8z"/></svg>
                  {formatPhone(cleaner.phone)}
                </a>
              )}
              {cleaner.whatsapp && (
                <a
                  href={cleaner.whatsapp.startsWith("http") ? cleaner.whatsapp : `https://wa.me/${cleaner.whatsapp}`}
                  target="_blank" rel="noreferrer"
                  className="w-full inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm hover:bg-gray-50"
                >
                  <svg className="h-4 w-4 mr-1.5" viewBox="0 0 32 32" fill="currentColor"><path d="M19.1 17.7c-.3-.2-1.7-.8-2-.9-.3-.1-.5-.2-.7.2s-.8.9-1 .9-.5 0-.8-.4c-.4-.5-.8-1-1.1-1.6-.3-.5 0-.7.2-.9.2-.2.3-.4.5-.6.2-.2.3-.4.1-.7-.1-.2-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.4-1.2 1.2-1.2 3s1.2 3.5 1.4 3.8c.2.3 2.4 3.7 5.9 5.1.8.3 1.5.5 2 .6.8.2 1.5.2 2.1.1.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4s-.1-.5-.4-.6z"/><path d="M27 5a12 12 0 0 0-19.1 14L6 26l7-1.8A12 12 0 1 0 27 5zm-6.5 19.4c-2 0-4-.5-5.8-1.5l-.4-.2-3.4.9.9-3.3-.3-.4A10.4 10.4 0 1 1 20.5 24.4z"/></svg>
                  WhatsApp
                </a>
              )}
              {cleaner.website && (
                <a
                  href={cleaner.website.startsWith("http") ? cleaner.website : `https://${cleaner.website}`}
                  target="_blank" rel="noreferrer"
                  className="w-full text-xs text-gray-500 underline text-center"
                >
                  Website
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function formatPhone(p?: string | null) {
  if (!p) return "";
  return p.replace(/^\+?44/, "+44 ").replace(/(\d{3})(\d{3})(\d{4})$/, "$1 $2 $3");
}
function labelFor(key: string) {
  switch (key) {
    case "bank_transfer": return "Bank Transfer";
    case "cash": return "Cash";
    case "stripe": return "Stripe";
    case "gocardless": return "GoCardless";
    case "paypal": return "PayPal";
    case "card_machine": return "Card Machine";
    default: return key;
  }
}
