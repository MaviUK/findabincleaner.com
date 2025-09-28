import { useState, useMemo } from "react";

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
  payment_methods?: string[] | null;
  service_types?: string[] | null; // ✅ added to satisfy Settings.tsx
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;
  preview?: boolean;
  showPayments?: boolean;
};

export default function CleanerCard({ cleaner, postcodeHint, preview, showPayments }: Props) {
  const [showPhone, setShowPhone] = useState(false);

  const contactUrl = useMemo(() => {
    if (cleaner.whatsapp) return normalizeWhatsApp(cleaner.whatsapp);
    if (cleaner.phone) return `tel:${digitsOnly(cleaner.phone)}`;
    return undefined;
  }, [cleaner.whatsapp, cleaner.phone]);

  const hasWebsite = !!cleaner.website;

  return (
    <div className="card card-pad flex flex-col gap-4">
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
          <div className="text-lg font-semibold text-cream-100 truncate">{cleaner.business_name}</div>
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

      <div className="flex flex-wrap gap-3 pt-2">
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

        {hasWebsite && (
          <a
            href={cleaner.website!}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost border border-white/10 hover:border-white/20"
          >
            Website
          </a>
        )}
      </div>

      {showPhone && cleaner.phone && (
        <div
          id={`phone_${slugify(cleaner.id || cleaner.business_name)}`}
          className="rounded-lg bg-night-800/70 border border-white/10 p-3 text-white/90 flex items-center justify-between"
        >
          <span className="font-medium tracking-wide">{prettyPhone(cleaner.phone)}</span>
          <a className="btn btn-primary" href={`tel:${digitsOnly(cleaner.phone)}`}>Call</a>
        </div>
      )}

      {showPayments && cleaner.payment_methods && cleaner.payment_methods.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {cleaner.payment_methods.map((m, i) => (
            <span key={i} className="badge-aqua">{m}</span>
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
  // accept either a wa.me link or a raw number
  if (input.startsWith("http")) return input;
  const digits = digitsOnly(input);
  const noPlus = digits.startsWith("+") ? digits.slice(1) : digits;
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
