// src/components/CleanerCard.tsx
import React from "react";
import { Link } from "react-router-dom";

type Cleaner = {
  id: string;
  business_name: string;
  logo_url?: string | null;
  address?: string | null;
  distance_m?: number | null;
  website?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  payment_methods?: string[] | null;
  service_types?: string[] | null; // <-- NEW (preview/profile)
};

export default function CleanerCard({
  cleaner,
  postcodeHint,
  preview = false, // <-- NEW
}: {
  cleaner: Cleaner;
  postcodeHint?: string;
  preview?: boolean;
}) {
  // ... keep your PM_ICON, helpers, etc., unchanged ...

  const km =
    typeof cleaner.distance_m === "number"
      ? (cleaner.distance_m / 1000).toFixed(1) + " km"
      : null;

  // Build chips: prefer service_types if provided, else fall back
  const chips =
    cleaner.service_types && cleaner.service_types.length
      ? cleaner.service_types.map((k) =>
          k === "domestic" ? "Domestic" : k === "commercial" ? "Commercial" : k
        )
      : ["Wheelie bin cleaning", "Eco-friendly", "Domestic & commercial"];

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

        {/* Middle */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base sm:text-lg font-semibold truncate">
              {cleaner.business_name}
            </h3>
            {/* optional RatingBadge... keep if you already have it */}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
            {postcodeHint && (
              <span className="inline-flex items-center gap-1">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>
                </svg>
                Operates in {postcodeHint.toUpperCase()}
              </span>
            )}
            {km && <span>• {km} away</span>}
          </div>

          {/* Chips */}
          <div className="mt-3 flex flex-wrap gap-2">
            {chips.map((txt) => (
              <span key={txt} className="text-xs rounded-full border px-2 py-1">
                {txt}
              </span>
            ))}
          </div>

          {/* Payments */}
          {payments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {payments.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                  <img src={PM_ICON[k]} alt={labelFor(k)} className="h-3.5 w-3.5" />
                  {labelFor(k)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right CTA column — hidden in preview mode */}
        {!preview && (
          <div className="shrink-0 flex flex-col items-end justify-between gap-2 w-[180px] md:w-[220px]">
            <Link
              to={`/cleaner/${cleaner.id}`}
              className="w-full inline-flex justify-center items-center rounded-full bg-[#ff4040] text-white text-sm font-semibold px-4 py-2 hover:brightness-95"
            >
              Request a quote
            </Link>

            {hasContact && (
              <div className="w-full flex flex-col gap-2">
                {cleaner.phone && (
                  <a href={`tel:${cleaner.phone}`} className="w-full inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm hover:bg-gray-50">
                    {/* phone icon omitted for brevity */}
                    {formatPhone(cleaner.phone)}
                  </a>
                )}
                {cleaner.whatsapp && (
                  <a
                    href={cleaner.whatsapp.startsWith("http") ? cleaner.whatsapp : `https://wa.me/${cleaner.whatsapp}`}
                    target="_blank" rel="noreferrer"
                    className="w-full inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm hover:bg-gray-50"
                  >
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
        )}
      </div>
    </article>
  );
}

// keep PM_ICON, labelFor, formatPhone helpers as in your current file
