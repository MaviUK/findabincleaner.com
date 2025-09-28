// src/components/CleanerCard.tsx
import { useMemo, useState } from "react";
import { PaymentPill } from "./icons/payments";
import { ServicePill } from "./icons/services";

// Broad type to match Settings/ResultsList usage
export type Cleaner = {
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

export type CleanerCardProps = {
  cleaner: Cleaner;
  postcodeHint?: string;
  preview?: boolean;
  showPayments?: boolean;
};

export default function CleanerCard({ cleaner, showPayments }: CleanerCardProps) {
  const [showPhone, setShowPhone] = useState(false);

  const contactUrl = useMemo(() => {
    if (cleaner.whatsapp) return normalizeWhatsApp(cleaner.whatsapp);
    if (cleaner.phone) return `tel:${digitsOnly(cleaner.phone)}`;
    return undefined;
  }, [cleaner.whatsapp, cleaner.phone]);

  return (
    <div className="bg-white text-night-900 rounded-xl shadow-soft border border-black/5 p-4 sm:p-5">
      {/* Top row */}
      <div className="flex items-stretch gap-5">
        {/* Left: logo panel + content */}
        <div className="flex items-stretch gap-5 flex-1 min-w-0">
          {/* Logo stretches full card height */}
          <div className="bg-black/5 rounded-2xl overflow-hidden self-stretch w-[164px] sm:w-[184px] flex items-center justify-center">
            {cleaner.logo_url ? (
              <img
                src={cleaner.logo_url}
                alt={`${cleaner.business_name} logo`}
                className="max-h-full max-w-full object-contain p-1 sm:p-2"
              />
            ) : (
              <span className="text-2xl font-semibold">
                {cleaner.business_name?.charAt(0) ?? "C"}
              </span>
            )}
          </div>

          {/* Content column */}
          <div className="min-w-0 flex flex-col">
            {/* Name + rating */}
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

            {/* Services — with title (NOT pinned to bottom) */}
            {cleaner.service_types?.length ? (
              <div className="pt-3">
                <div className="text-sm font-medium text-night-800 mb-1.5">Services</div>
                <div className="flex flex-wrap gap-1.5">
                  {cleaner.service_types.map((s, i) => (
                    <ServicePill key={`svc-${i}`} kind={s} />
                  ))}
                </div>
              </div>
            ) : null}

            {/* Payments — title + pills, pinned to bottom */}
            {(showPayments ?? true) && cleaner.payment_methods?.length ? (
              <div className="mt-auto pt-3 border-t border-black/5">
                <div className="text-sm font-medium text-night-800 mb-1.5">
                  Payments Accepted
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {cleaner.payment_methods.map((m, i) => (
                    <PaymentPill key={`pay-${i}`} kind={m} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Right: stacked actions, centered vertically & right-aligned */}
        <div className="self-stretch flex flex-col items-end justify-center gap-1 sm:gap-2 shrink-0">
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
                  <span className="font-medium tracking-wide truncate">
                    {prettyPhone(cleaner.phone)}
                  </span>
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
