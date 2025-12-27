// src/components/CleanerCard.tsx
import { useMemo } from "react";
import { getOrCreateSessionId, recordEventFetch } from "../lib/analytics";

type Cleaner = {
  cleaner_id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp?: string | null;
  distance_m?: number | null;

  area_id?: string | null;
  area_name?: string | null;
  category_id?: string | null;

  is_covering_sponsor?: boolean;
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;
  showPayments?: boolean;
  areaId?: string | null;
  categoryId?: string | null;
  position?: number;
  featured?: boolean;
};

function normalizeUrl(u: string) {
  const trimmed = u.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export default function CleanerCard({
  cleaner,
  areaId,
  categoryId,
  position,
  featured,
}: Props) {
  const sessionId = useMemo(() => getOrCreateSessionId(), []);

  const name = cleaner.business_name || "Cleaner";
  const websiteUrl = cleaner.website ? normalizeUrl(cleaner.website) : "";
  const phone = cleaner.phone?.trim() || "";
  const whatsapp = cleaner.whatsapp?.trim() || "";

  function logClick(event: "click_message" | "click_phone" | "click_website") {
    try {
      void recordEventFetch({
        event,
        cleanerId: cleaner.cleaner_id,
        areaId: areaId ?? null,
        categoryId: categoryId ?? null,
        sessionId,
        meta: { position: position ?? null },
      });
    } catch (e) {
      console.warn("record click failed", e);
    }
  }

  function openWhatsAppOrCall() {
    if (whatsapp) {
      const wa = whatsapp.replace(/[^\d+]/g, "");
      window.open(`https://wa.me/${wa}`, "_blank", "noopener,noreferrer");
      return;
    }
    if (phone) window.location.href = `tel:${phone}`;
  }

  // ✅ Featured logo should match height of 3 stacked buttons (~136px) → use 144px
  const logoBoxClass = featured
    ? "h-36 w-36 rounded-2xl bg-white border-2 border-emerald-300 shadow-sm overflow-hidden shrink-0 flex items-center justify-center"
    : "h-16 w-16 rounded-xl bg-gray-100 overflow-hidden shrink-0 flex items-center justify-center";

  const logoImgClass = featured
    ? "h-full w-full object-contain p-2"
    : "h-full w-full object-cover";

  return (
    <div className="rounded-2xl border border-black/5 bg-white shadow-sm p-4 sm:p-5 flex gap-4">
      {/* Logo */}
      <div className={logoBoxClass}>
        {cleaner.logo_url ? (
          <img
            src={cleaner.logo_url}
            alt={cleaner.business_name ?? "Business logo"}
            className={logoImgClass}
          />
        ) : null}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          {/* Info */}
          <div className={`min-w-0 ${featured ? "pt-1" : ""}`}>
            <div className="text-lg font-bold text-gray-900 truncate">{name}</div>

            {typeof cleaner.distance_m === "number" && (
              <div className="text-xs text-gray-500 mt-1">
                {(cleaner.distance_m / 1000).toFixed(1)} km
              </div>
            )}

            {/* MOBILE ICON ACTIONS */}
            <div className="flex gap-3 mt-3 sm:hidden">
              {/* Message */}
              <button
                type="button"
                className="h-10 w-10 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 disabled:opacity-40"
                onClick={() => {
                  logClick("click_message");
                  openWhatsAppOrCall();
                }}
                disabled={!whatsapp && !phone}
                title="Message"
              >
                💬
              </button>

              {/* Phone */}
              <button
                type="button"
                className="h-10 w-10 rounded-full border border-blue-200 text-blue-700 flex items-center justify-center hover:bg-blue-50 disabled:opacity-40"
                onClick={() => {
                  logClick("click_phone");
                  if (phone) window.location.href = `tel:${phone}`;
                }}
                disabled={!phone}
                title="Call"
              >
                📞
              </button>

              {/* Website */}
              <button
                type="button"
                className="h-10 w-10 rounded-full border border-gray-200 text-gray-800 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40"
                onClick={() => {
                  logClick("click_website");
                  if (websiteUrl) window.open(websiteUrl, "_blank", "noopener,noreferrer");
                }}
                disabled={!websiteUrl}
                title="Website"
              >
                🌐
              </button>
            </div>
          </div>

          {/* DESKTOP ACTIONS */}
          <div className="shrink-0 hidden sm:flex flex-col gap-2 w-44">
            <button
              type="button"
              className="h-10 rounded-full bg-red-500 text-white font-semibold text-sm hover:bg-red-600 disabled:opacity-50"
              onClick={() => {
                logClick("click_message");
                openWhatsAppOrCall();
              }}
              disabled={!whatsapp && !phone}
            >
              Message
            </button>

            <button
              type="button"
              className="h-10 rounded-full border border-blue-200 text-blue-700 font-semibold text-sm hover:bg-blue-50 disabled:opacity-50"
              onClick={() => {
                logClick("click_phone");
                if (phone) window.location.href = `tel:${phone}`;
              }}
              disabled={!phone}
            >
              Phone
            </button>

            <button
              type="button"
              className="h-10 rounded-full border border-gray-200 text-gray-800 font-semibold text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={() => {
                logClick("click_website");
                if (websiteUrl) window.open(websiteUrl, "_blank", "noopener,noreferrer");
              }}
              disabled={!websiteUrl}
            >
              Website
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
