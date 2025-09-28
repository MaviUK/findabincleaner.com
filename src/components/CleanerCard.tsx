// src/components/CleanerCard.tsx
import { useMemo, useState } from "react";

/** Broad type to match Settings/ResultsList usage */
type Cleaner = {
  id: string;
  business_name: string;
  logo_url?: string | null;
  distance_m?: number | null;

  website?: string | null;
  phone?: string | null;
  whatsapp?: string | null;

  rating_avg?: number | null;
  rating_count?: number | null;

  payment_methods?: string[] | null; // ["bank_transfer","gocardless","paypal","cash","stripe","card_machine"]
  service_types?: string[] | null;   // ["domestic","commercial"]
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;  // kept for compatibility
  preview?: boolean;      // kept for compatibility
  showPayments?: boolean; // default true
};

export default function CleanerCard({ cleaner, showPayments }: Props) {
  const [showPhone, setShowPhone] = useState(false);

  const contactUrl = useMemo(() => {
    if (cleaner.whatsapp) return normalizeWhatsApp(cleaner.whatsapp);
    if (cleaner.phone) return `tel:${digitsOnly(cleaner.phone)}`;
    return undefined;
  }, [cleaner.whatsapp, cleaner.phone]);

  return (
    <div className="bg-white text-night-900 rounded-xl shadow-soft border border-black/5 p-4 sm:p-5">
      {/* Top row */}
      <div className="flex items-start gap-5">
        {/* Left: BIG logo + name (logo same height as 3 stacked buttons) */}
        <div className="flex items-start gap-5 flex-1 min-w-0">
          <div className="bg-black/5 rounded-2xl overflow-hidden grid place-items-center
                          h-[128px] w-[128px] sm:h-[136px] sm:w-[136px]">
            {cleaner.logo_url ? (
              <img
                src={cleaner.logo_url}
                alt={`${cleaner.business_name} logo`}
                className="max-h-full max-w-full object-contain p-2"
              />
            ) : (
              <span className="text-2xl font-semibold">{cleaner.business_name?.charAt(0) ?? "C"}</span>
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="truncate text-xl md:text-2xl font-bold">
                {cleaner.business_name}
              </div>

              {isFiniteNumber(cleaner.rating_avg) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 px-2.5 py-1 text-xs md:text-sm ring-1 ring-blue-200">
                  <span className="font-semibold">{Number(cleaner.rating_avg).toFixed(2)}</span>
                  {isFiniteNumber(cleaner.rating_count) && (
                    <span className="opacity-70">({cleaner.rating_count} reviews)</span>
                  )}
                </span>
              )}
            </div>

            {/* Payment chips with SVG icons */}
            {(showPayments ?? true) &&
              cleaner.payment_methods &&
              cleaner.payment_methods.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {cleaner.payment_methods.map((m, i) => (
                    <span
                      key={`pay-${i}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-black/5 text-night-800 px-2.5 py-1 text-xs ring-1 ring-black/10"
                    >
                      <PaymentIcon kind={m} />
                      {PAYMENT_LABELS[m] ?? m}
                    </span>
                  ))}
                </div>
              )}

            {/* Services & skills with icons */}
            {(cleaner.service_types?.length ?? 0) > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {cleaner.service_types!.map((s, i) => (
                  <span
                    key={`svc-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-black/10 bg-white"
                  >
                    <ServiceIcon kind={s} />
                    {SERVICE_LABELS[s] ?? s}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: actions STACKED, same width, right-aligned
            - mobile: gap-1 -> total height 128px (3*40 + 8)
            - sm+: gap-2 -> total height 136px (3*40 + 16)
        */}
        <div className="flex flex-col items-end gap-1 sm:gap-2 shrink-0">
          {/* Fixed width & height so all buttons match */}
          {contactUrl && (
            <a
              href={contactUrl}
              target={contactUrl.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-full h-10 w-40 text-sm font-semibold bg-[#F44336] text-white hover:bg-[#E53935]"
            >
              Message
            </a>
          )}

          {cleaner.phone && (
            <>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full h-10 w-40 text-sm font-semibold bg-white text-[#0B1B2A] ring-1 ring-[#1D4ED8]/30 hover:ring-[#1D4ED8]/50"
                onClick={() => setShowPhone(s => !s)}
                aria-expanded={showPhone}
                aria-controls={`phone_${slugify(cleaner.id || cleaner.business_name)}`}
              >
                {showPhone ? "Hide phone" : "Show phone number"}
              </button>

              {showPhone && (
                <div
                  id={`phone_${slugify(cleaner.id || cleaner.business_name)}`}
                  className="rounded-lg bg-black/5 border border-black/10 p-3 text-night-900 flex items-center justify-between gap-3 w-40"
                >
                  <span className="font-medium tracking-wide truncate">{prettyPhone(cleaner.phone)}</span>
                  <a
                    className="inline-flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-semibold bg-[#F44336] text-white hover:bg-[#E53935]"
                    href={`tel:${digitsOnly(cleaner.phone)}`}
                  >
                    Call
                  </a>
                </div>
              )}
            </>
          )}

          {cleaner.website && (
            <a
              href={cleaner.website}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-full h-10 w-40 text-sm font-semibold bg-white text-[#0B1B2A] ring-1 ring-black/10 hover:ring-black/20"
            >
              Website
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Icons ---------- */

const PAYMENT_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  gocardless: "GoCardless",
  paypal: "PayPal",
  cash: "Cash",
  stripe: "Stripe",
  card_machine: "Card Machine",
};

function PaymentIcon({ kind }: { kind?: string }) {
  switch (kind) {
    case "stripe":
      return (
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#635BFF" d="M8 10h32v28H8z" />
          <path
            fill="#fff"
            d="M31.2 26.6c0-2.5-2.1-3.3-5.6-3.7-3-.4-3.6-.8-3.6-1.6 0-.8.8-1.3 2.3-1.3 1.5 0 3 .5 4.4 1.3l.9-3.5c-1.5-.8-3.3-1.2-5.1-1.2-3.6 0-6.1 1.9-6.1 4.8 0 2.6 2.3 3.5 5.7 3.9 2.9.4 3.5.8 3.5 1.6 0 .9-.9 1.4-2.6 1.4-1.8 0-3.6-.6-5.2-1.6l-1 3.6c1.7 1 3.9 1.6 6.1 1.6 3.9 0 6.3-1.9 6.3-4.7z"
          />
        </svg>
      );
    case "paypal":
      return (
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#003087" d="M8 8h32v32H8z" />
          <path
            fill="#fff"
            d="M30 16c-1.7-1.2-4.1-1.7-6.9-1.7h-7.6l-3 19.3h5.2l.8-5h2.4c5.3 0 9.2-2.5 10.1-7.5.4-2.1.1-3.5-1-5.1z"
          />
        </svg>
      );
    case "gocardless":
      return (
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
          <rect x="8" y="10" width="32" height="28" rx="4" fill="#0E4D92" />
          <path fill="#fff" d="M24 30c-3.3 0-6-2.7-6-6s2.7-6 6-6h12v4H24a2 2 0 100 4h12v4H24z" />
        </svg>
      );
    case "bank_transfer":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#0B1B2A" d="M12 3l9 5v2H3V8l9-5zM4 11h16v9H4z" />
          <path fill="#fff" d="M7 13h3v5H7zm7 0h3v5h-3z" />
        </svg>
      );
    case "card_machine":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="3" width="14" height="18" rx="2" fill="#0B1B2A" />
          <rect x="7" y="6" width="10" height="2" fill="#fff" />
          <rect x="7" y="10" width="10" height="6" fill="#37D9E6" />
        </svg>
      );
    case "cash":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="6" width="18" height="12" rx="2" fill="#16C172" />
          <circle cx="12" cy="12" r="3" fill="#fff" />
        </svg>
      );
    default:
      return (
        <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="10" fill="currentColor" className="text-black/30" />
        </svg>
      );
  }
}

const SERVICE_LABELS: Record<string, string> = {
  domestic: "Domestic",
  commercial: "Commercial",
};

function ServiceIcon({ kind }: { kind?: string }) {
  if (kind === "domestic") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 12l9-7 9 7v8a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-8z" fill="#0B1B2A" />
      </svg>
    );
  }
  if (kind === "commercial") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 21h18V8H3v13zm3-2v-4h4v4H6zm6 0v-7h4v7h-4zM6 9h12V6H6v3z" fill="#0B1B2A" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="currentColor" className="text-black/30" />
    </svg>
  );
}

/* ---------- helpers ---------- */
function slugify(s?: string) {
  return (s || "").toLowerCase().replace(/\s+/g, "_").replace(/[^\w-]/g, "");
}
function digitsOnly(s: string) {
  return s.replace(/[^\d+]/g, "");
}
function normalizeWhatsApp(input: string) {
  if (input.startsWith("http")) return input;
  const d = digitsOnly(input);
  const noPlus = d.startsWith("+") ? d.slice(1) : d;
  return `https://wa.me/${noPlus}`;
}
function prettyPhone(p?: string) {
  if (!p) return "";
  const d = digitsOnly(p);
  if (d.startsWith("+44")) return "+44 " + d.slice(3).replace(/(\d{4})(\d{3})(\d{3})/, "$1 $2 $3");
  if (d.length === 11 && d.startsWith("0")) return d.replace(/(\d{5})(\d{3})(\d{3})/, "$1 $2 $3");
  return p;
}
function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
