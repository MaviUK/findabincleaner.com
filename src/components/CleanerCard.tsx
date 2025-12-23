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

  // carried through from FindCleaners
  area_id?: string | null;
  area_name?: string | null;
  category_id?: string | null;

  is_covering_sponsor?: boolean;
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;
  showPayments?: boolean;

  // explicitly passed so analytics never “loses” them
  areaId?: string | null;
  categoryId?: string | null;

  position?: number; // for meta
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
}: Props) {
  const sessionId = useMemo(() => getOrCreateSessionId(), []);

  const name = cleaner.business_name || "Cleaner";
  const websiteUrl = cleaner.website ? normalizeUrl(cleaner.website) : "";
  const phone = cleaner.phone?.trim() || "";
  const whatsapp = cleaner.whatsapp?.trim() || "";

  async function logClick(event: "click_message" | "click_phone" | "click_website") {
    try {
      await recordEventFetch({
        event,
        cleanerId: cleaner.cleaner_id,
        areaId: areaId ?? cleaner.area_id ?? null,
        categoryId: categoryId ?? cleaner.category_id ?? null,
        sessionId,
        meta: {
          position: position ?? null,
        },
      });
    } catch (e) {
      // don't break UX if analytics fails
      console.warn("record click failed", e);
    }
  }

  return (
    <div className="rounded-2xl border border-black/5 bg-white shadow-sm p-4 sm:p-5 flex gap-4">
      <div className="h-20 w-20 rounded-xl bg-gray-100 overflow-hidden shrink-0">
        {cleaner.logo_url ? (
          <img
            src={cleaner.logo_url}
            alt={name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : null}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-bold text-gray-900 truncate">{name}</div>
            {typeof cleaner.distance_m === "number" && (
              <div className="text-xs text-gray-500 mt-1">
                {(cleaner.distance_m / 1000).toFixed(1)} km
              </div>
            )}
          </div>

          <div className="shrink-0 flex flex-col gap-2 w-44">
            {/* MESSAGE */}
            <button
              type="button"
              className="h-10 rounded-full bg-red-500 text-white font-semibold text-sm hover:bg-red-600"
              onClick={async () => {
                await logClick("click_message");
                // If you want WhatsApp deep link:
                if (whatsapp) {
                  const wa = whatsapp.replace(/[^\d+]/g, "");
                  window.open(`https://wa.me/${wa}`, "_blank", "noopener,noreferrer");
                } else if (phone) {
                  window.location.href = `tel:${phone}`;
                }
              }}
            >
              Message
            </button>

            {/* PHONE */}
            <button
              type="button"
              className="h-10 rounded-full border border-blue-200 text-blue-700 font-semibold text-sm hover:bg-blue-50"
              onClick={async () => {
                await logClick("click_phone");
                if (phone) window.location.href = `tel:${phone}`;
              }}
              disabled={!phone}
              title={!phone ? "No phone number provided" : undefined}
            >
              Phone
            </button>

            {/* WEBSITE (real external link, NEVER react-router) */}
            <button
              type="button"
              className="h-10 rounded-full border border-gray-200 text-gray-800 font-semibold text-sm hover:bg-gray-50"
              onClick={async () => {
                await logClick("click_website");
                if (websiteUrl) window.open(websiteUrl, "_blank", "noopener,noreferrer");
              }}
              disabled={!websiteUrl}
              title={!websiteUrl ? "No website provided" : undefined}
            >
              Website
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
