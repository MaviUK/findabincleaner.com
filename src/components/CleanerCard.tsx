import { useMemo, useState } from "react";

/** ---- Types kept broad so Settings.tsx object literals pass ---- */
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

  payment_methods?: string[] | null; // e.g. ["bank_transfer","gocardless","paypal","cash","stripe","card_machine"]
  service_types?: string[] | null;   // e.g. ["domestic","commercial"]
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;
  preview?: boolean;
  showPayments?: boolean; // keep existing prop from Settings
};

/** ---- label helpers (icons optional) ---- */
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
    <div className="card card-pad flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-center gap-4">
        {cleaner.logo_url ? (
          <img
            src={cleaner.logo_url}
            alt={`${cleaner.business_name} logo`}
            className="h-12 w-12 rounded-lg object-contain bg-white/5 p-1"
          />
        ) : (
          <div className="h-12 w-12 rounded-lg bg-white/10 grid place-items-center text-white/70">
            {cleaner.business_name?.charAt(0) ?? "C"}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold text-cream-100 truncate">
            {cleaner.business_name}
          </div>
          <div className="text-sm text-white/70 truncate">
            {!preview && isFiniteNumber(cleaner.distance_m)
              ? `${(Number(cleaner.distance_m) / 1000).toFixed(1)} km away`
              : postcodeHint || ""}
          </div>
        </div>

        {isFiniteNumber(cleaner.rating_avg) && (
          <div className="text-sm text-white/70 shrink-0">
            ★ {Number(cleaner.rating_avg).toFixed(1)}
            {isFiniteNumber(cleaner.rating_count) ? ` (${cleaner.rating_count})` : ""}
          </div>
        )}
      </div>

      {/* Actions aligned to right */}
      <div className="flex flex-wrap gap-3 pt-2 justify-end">
        {contactUrl && (
          <a
            href={contactUrl}
            target={contactUrl.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
            className="btn btn-primary rounded-xl2"
          >
            Contact
          </a>
        )}

        {cleaner.phone && (
          <button
            type="button"
            className="btn btn-ghost border border-white/10 hover:border-white/20"
            onClick={() => setShowPhone(s => !s)}
            aria-expanded={showPhone}
            aria-controls={`phone_${slugify(cleaner.id || cleaner.business_name)}`}
          >
            {showPhone ? "Hide number" : "Phone"}
          </button>
        )}

        {cleaner.website && (
          <a
            href={cleaner.website}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost border border-white/10 hover:border-white/20"
          >
            Website
          </a>
        )}
      </div>

      {/* Revealed phone strip */}
      {showPhone && cleaner.phone && (
        <div
          id={`phone_${slugify(cleaner.id || cleaner.business_name)}`}
          className="rounded-lg bg-night-800/70 border border-white/10 p-3 text-white/90 flex items-center justify-between"
        >
          <span className="font-medium tracking-wide">{prettyPhone(cleaner.phone)}</span>
          <a className="btn btn-primary" href={`tel:${digitsOnly(cleaner.phone)}`}>Call</a>
        </div>
      )}

      {/* Service Types (pills) */}
      {cleaner.service_types && cleaner.service_types.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {cleaner.service_types.map((s, i) => (
            <span
              key={`svc-${i}`}
              className="inline-flex items-center gap-2 rounded-full bg-black text-white px-3 py-1 text-xs ring-1 ring-white/10"
            >
              {/* simple glyph; replace with SVG if you have icons */}
              <span className="i">🧼</span>
              {SERVICE_LABELS[s] ?? s}
            </span>
          ))}
        </div>
      )}

      {/* Payment methods (pills) */}
      {(showPayments ?? true) &&
        cleaner.payment_methods &&
        cleaner.payment_methods.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {cleaner.payment_methods.map((m, i) => (
              <span
                key={`pay-${i}`}
                className="inline-flex items-center gap-2 rounded-full bg-black text-white px-3 py-1 text-xs ring-1 ring-white/10"
              >
                <span className="i">💳</span>
                {PAYMENT_LABELS[m] ?? m}
              </span>
            ))}
          </div>
        )}
    </div>
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
  if (input.startsWith("http")) return input;           // already a wa.me link
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
