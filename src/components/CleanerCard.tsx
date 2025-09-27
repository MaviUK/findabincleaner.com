// src/components/CleanerCard.tsx
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PM_ICON, PM_LABEL } from "../constants/paymentMethods";

type Cleaner = {
  id: string;
  business_name: string;
  logo_url?: string | null;
  address?: string | null;
  distance_m?: number | null;
  website?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  contact_email?: string | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  payment_methods?: string[] | null;
  service_types?: string[] | null; // ["domestic","commercial"]
};

const HomeIcon = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
    <path fill="currentColor" d="M12 3 3 10v10h6v-6h6v6h6V10z" />
  </svg>
);
const OfficeIcon = () => (
  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
    <path fill="currentColor" d="M3 21V5a2 2 0 0 1 2-2h6v18H3zm10 0V9h6a2 2 0 0 1 2 2v10h-8zM7 7h2v2H7V7zm0 4h2v2H7v-2z" />
  </svg>
);

const SERVICE_META: Record<string, { label: string; Icon: React.FC }> = {
  domestic: { label: "Domestic", Icon: HomeIcon },
  commercial: { label: "Commercial", Icon: OfficeIcon },
};

export default function CleanerCard({
  cleaner,
  postcodeHint,
  preview = false,
  showPayments = true,
}: {
  cleaner: Cleaner;
  postcodeHint?: string;
  preview?: boolean;
  showPayments?: boolean;
}) {
  const [showPhone, setShowPhone] = useState(false);
  const [showLogoModal, setShowLogoModal] = useState(false);

  const km =
    typeof cleaner.distance_m === "number"
      ? (cleaner.distance_m / 1000).toFixed(1) + " km"
      : null;

  // Services from service_types
  const services = (cleaner.service_types ?? []).map((k) => SERVICE_META[k]).filter(Boolean);

  // Payments
  const payments = (cleaner.payment_methods ?? []).filter((k) => (PM_ICON as any)[k]);
  const hasContact = cleaner.phone || cleaner.whatsapp || cleaner.contact_email || cleaner.website;

  const contactHref = useMemo(() => {
    if (cleaner.contact_email) return `mailto:${cleaner.contact_email}`;
    if (cleaner.whatsapp) return normaliseWhatsApp(cleaner.whatsapp);
    if (cleaner.phone) return toTelHref(cleaner.phone);
    return undefined;
  }, [cleaner.contact_email, cleaner.whatsapp, cleaner.phone]);

  return (
    <>
      <article className="rounded-2xl border bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex gap-4">
          {/* Logo (click to 500×500 preview) */}
          <button
            className="shrink-0 group"
            type="button"
            onClick={() => cleaner.logo_url && setShowLogoModal(true)}
            aria-label="View logo"
          >
            <div className="h-24 w-24 md:h-28 md:w-28 rounded-xl border bg-white overflow-hidden flex items-center justify-center">
              {cleaner.logo_url ? (
                <img
                  src={cleaner.logo_url}
                  alt=""
                  className="h-full w-full object-cover"
                  width={112}
                  height={112}
                />
              ) : (
                <div className="text-xs text-gray-400">Logo</div>
              )}
            </div>
            {cleaner.logo_url && (
              <span className="block text-[10px] text-gray-400 mt-1 group-hover:underline">
                Click to preview
              </span>
            )}
          </button>

          {/* Middle column */}
          <div className="min-w-0 flex-1 flex flex-col">
            {/* Top: name + meta */}
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-semibold truncate">
                  {cleaner.business_name}
                </h3>
                {typeof cleaner.rating_avg === "number" && (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 text-blue-700 px-2 py-1 text-sm font-semibold">
                    {cleaner.rating_avg.toFixed(2)}
                    {typeof cleaner.rating_count === "number" && (
                      <span className="ml-1 text-xs font-normal text-blue-600">
                        ({cleaner.rating_count} review{cleaner.rating_count === 1 ? "" : "s"})
                      </span>
                    )}
                  </span>
                )}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
                {postcodeHint && (
                  <span className="inline-flex items-center gap-1">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
                    </svg>
                    Operates in {postcodeHint.toUpperCase()}
                  </span>
                )}
                {km && <span>• {km} away</span>}
              </div>

              {/* Services row */}
              {services.length > 0 && (
                <div className="mt-3 text-sm text-gray-800">
                  <span className="font-medium">Services: </span>
                  <span className="inline-flex flex-wrap gap-2 align-middle">
                    {services.map(({ label, Icon }) => (
                      <span
                        key={label}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs"
                      >
                        <Icon />
                        {label}
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </div>

            {/* Bottom: payments pinned to bottom of middle column */}
            {showPayments && payments.length > 0 && (
              <div className="mt-4 md:mt-auto pt-2 flex flex-wrap gap-1.5">
                {payments.map((k) => (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs"
                  >
                    <img
                      src={(PM_ICON as Record<string, string>)[k]}
                      alt={(PM_LABEL as Record<string, string>)[k]}
                      className="h-3.5 w-3.5"
                    />
                    {(PM_LABEL as Record<string, string>)[k]}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Right CTA column */}
          {!preview && (
            <div className="shrink-0 flex flex-col items-end justify-between gap-2 w-[190px] md:w-[230px]">
              <Link
                to={`/cleaner/${cleaner.id}`}
                className="w-full inline-flex justify-center items-center rounded-full bg-[#ff4040] text-white text-sm font-semibold px-4 py-2 hover:brightness-95"
              >
                Request a quote
              </Link>

              {hasContact && (
                <div className="w-full flex flex-col gap-2">
                  {/* Contact (email/WA/tel fallback) */}
                  {contactHref && (
                    <a
                      href={contactHref}
                      target={contactHref.startsWith("http") ? "_blank" : undefined}
                      rel={contactHref.startsWith("http") ? "noreferrer" : undefined}
                      className="w-full inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm hover:bg-gray-50"
                    >
                      Contact
                    </a>
                  )}

                  {/* Phone reveal */}
                  {cleaner.phone &&
                    (showPhone ? (
                      <a
                        href={toTelHref(cleaner.phone) ?? "#"}
                        className="w-full inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm hover:bg-gray-50"
                      >
                        {formatPhone(cleaner.phone)}
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowPhone(true)}
                        className="w-full inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm hover:bg-gray-50"
                      >
                        Show phone
                      </button>
                    ))}

                  {/* Website */}
                  {cleaner.website && (
                    <a
                      href={
                        cleaner.website.startsWith("http")
                          ? cleaner.website
                          : `https://${cleaner.website}`
                      }
                      target="_blank"
                      rel="noreferrer"
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

      {/* Logo preview modal @ 500×500 */}
      {showLogoModal && cleaner.logo_url && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          aria-modal="true"
          role="dialog"
          onClick={() => setShowLogoModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-3 shadow-xl max-w-[520px] w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={cleaner.logo_url}
              alt="Logo preview"
              className="mx-auto rounded-xl object-contain"
              width={500}
              height={500}
              style={{ width: 500, height: 500 }}
            />
            <button
              type="button"
              onClick={() => setShowLogoModal(false)}
              className="mt-3 w-full rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- helpers ---------- */
function toTelHref(phone?: string | null) {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : undefined;
}
function normaliseWhatsApp(value: string) {
  if (value.startsWith("http")) return value;
  let digits = value.replace(/[^\d+]/g, "");
  if (!digits) return `https://wa.me/`;
  if (!digits.startsWith("+")) {
    if (digits.startsWith("0")) digits = `44${digits.slice(1)}`;
  } else {
    digits = digits.replace("+", "");
  }
  return `https://wa.me/${digits}`;
}
function formatPhone(p?: string | null) {
  if (!p) return "";
  const digits = p.replace(/\s+/g, "");
  if (digits.startsWith("+44")) {
    return digits.replace(/^\+?44/, "+44 ").replace(/(\d{3})(\d{3})(\d{4})$/, "$1 $2 $3");
  }
  return p;
}
