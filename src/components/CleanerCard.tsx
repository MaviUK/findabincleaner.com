import { useMemo, useState } from "react";

/** Types stay broad to match Settings.tsx usage */
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
  postcodeHint?: string;
  preview?: boolean;
  showPayments?: boolean;
};

const PAYMENT_LABELS: Record<string, string> = {
  bank_transfer: "Bank Transfer",
  gocardless: "GoCardless",
  paypal: "PayPal",
  cash: "Cash",
  stripe: "Stripe",
  card_machine: "Card Machine",
};

const SERVICE_LABELS: Record<string, string> = {
  domestic: "Domestic",
  commercial: "Commercial",
};

export default function CleanerCard({ cleaner, postcodeHint, preview, showPayments }: Props) {
  const [showPhone, setShowPhone] = useState(false);

  const contactUrl = useMemo(() => {
    if (cleaner.whatsapp) return normalizeWhatsApp(cleaner.whatsapp);
    if (cleaner.phone) return `tel:${digitsOnly(cleaner.phone)}`;
    return undefined;
  }, [cleaner.whatsapp, cleaner.phone]);

  return (
    <div className="bg-white text-night-900 rounded-xl shadow-soft border border-black/5 p-4 sm:p-5">
      {/* Top row: left info + right actions */}
      <div className="flex items-start gap-4">
        {/* Left: logo + name + rating + operates-in */}
        <div className="flex items-start gap-4 flex-1 min-w-0">
          {cleaner.logo_url ? (
            <img
              src={cleaner.logo_url}
              alt={`${cleaner.business_name} logo`}
              className="h-14 w-14 rounded-lg object-contain bg-black/5 p-1"
            />
          ) : (
            <div className="h-14 w-14 rounded-lg bg-black/5 grid place-items-center">
              <span className="font-semibold">{cleaner.business_name?.charAt(0) ?? "C"}</span>
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="font-semibold truncate">{cleaner.business_name}</div>
              {isFiniteNumber(cleaner.rating_avg) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 px-2.5 py-1 text-xs ring-1 ring-blue-200">
                  <span className="font-semibold">{Number(cleaner.rating_avg).toFixed(2)}</span>
                  {isFiniteNumber(cleaner.rating_count) && (
                    <span className="opacity-70">({cleaner.rating_count} reviews)</span>
                  )}
                </span>
              )}
            </div>

            <div className="mt-1 text-sm text-night-700/80">
              {!preview && isFiniteNumber(cleaner.distance_m)
                ? `${(Number(cleaner.distance_m) / 1000).toFixed(1)} km away`
                : `Operates in ${postcodeHint || "your area"}`}
            </div>

            {(showPayments ?? true) &&
              cleaner.payment_methods &&
              cleaner.payment_methods.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {cleaner.payment_methods.map((m, i) => (
                    <span
                      key={`pay-${i}`}
                      className="inline-flex items-center rounded-full bg-black/5 text-night-800 px-2.5 py-0.5 text-xs ring-1 ring-black/10"
                    >
                      {PAYMENT_LABELS[m] ?? m}
                    </span>
                  ))}
                </div>
              )}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {contactUrl && (
            <a
              href={contactUrl}
              target={contactUrl.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
              className="btn btn-cta"
            >
              {/* ➜ */} Message
            </a>
          )}

          {cleaner.phone && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setShowPhone(s => !s)}
              aria-expanded={showPhone}
              aria-controls={`phone_${slugify(cleaner.id || cleaner.business_name)}`}
            >
              Show phone number
            </button>
          )}
        </div>
      </div>

      {/* Services & skills */}
      {(cleaner.service_types?.length ?? 0) > 0 && (
        <div className="mt-4 pt-3 border-t border-black/5">
          <div className="text-sm font-medium text-night-800 mb-1.5">Services &amp; skills</div>
          <div className="flex flex-wrap gap-2">
            {cleaner.service_types!.map((s, i) => (
              <span
                key={`svc-${i}`}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-black/10 bg-white"
              >
                <TickIcon />
                {SERVICE_LABELS[s] ?? s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reveal phone strip */}
      {showPhone && cleaner.phone && (
        <div
          id={`phone_${slugify(cleaner.id || cleaner.business_name)}`}
          className="mt-3 rounded-lg bg-black/5 border border-black/10 p-3 text-night-900 flex items-center justify-between"
        >
          <span className="font-medium tracking-wide">{prettyPhone(cleaner.phone)}</span>
          <a className="btn btn-cta" href={`tel:${digitsOnly(cleaner.phone)}`}>Call</a>
        </div>
      )}
    </div>
  );
}

/* Icons */
function TickIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="currentColor" className="text-blue-600/10" />
      <path d="M6 10.5l2.5 2.5L14 8" stroke="#1D4ED8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* helpers */
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
