// src/components/CleanerCard.tsx
import { useMemo } from "react";
import { recordEventBeacon, getOrCreateSessionId } from "../lib/analytics";

export type Cleaner = {
  id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp: string | null;
  distance_m: number | null;
  rating_avg: number | null;
  rating_count: number | null;
  payment_methods?: string[];
  service_types?: string[];
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;
  showPayments?: boolean;

  /** IMPORTANT for analytics */
  areaId?: string | null;
  categoryId?: string | null;

  /** optional fallback if your backend ever uses it */
  searchLat?: number | null;
  searchLng?: number | null;
};

function km(m?: number | null) {
  if (!m && m !== 0) return null;
  return `${(m / 1000).toFixed(1)} km`;
}

export default function CleanerCard({
  cleaner,
  postcodeHint,
  showPayments = false,
  areaId = null,
  categoryId = null,
  searchLat = null,
  searchLng = null,
}: Props) {
  const displayName = cleaner.business_name || "Cleaner";

  const logo = useMemo(() => {
    return cleaner.logo_url || "";
  }, [cleaner.logo_url]);

  async function logClick(event: "click_message" | "click_phone" | "click_website") {
    try {
      const sessionId = getOrCreateSessionId();
      await recordEventBeacon({
        cleanerId: cleaner.id,
        event,
        sessionId,
        categoryId: categoryId ?? null,
        areaId: areaId ?? null,
        meta: {
          postcode_hint: postcodeHint ?? null,
          search_lat: searchLat ?? null,
          search_lng: searchLng ?? null,
        },
      });
    } catch {
      // ignore
    }
  }

  const phoneHref = cleaner.phone ? `tel:${cleaner.phone}` : null;
  const websiteHref = cleaner.website || null;

  // WhatsApp: prefer whatsapp field, fallback to phone if present
  const wa = (cleaner.whatsapp || "").trim();
  const whatsappHref = wa
    ? wa.startsWith("http")
      ? wa
      : `https://wa.me/${wa.replace(/[^\d]/g, "")}`
    : cleaner.phone
    ? `https://wa.me/${cleaner.phone.replace(/[^\d]/g, "")}`
    : null;

  return (
    <div className="rounded-2xl border border-black/10 bg-white shadow-sm p-6 flex items-center gap-6">
      <div className="h-28 w-28 rounded-2xl overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
        {logo ? (
          <img src={logo} alt={displayName} className="h-full w-full object-cover" />
        ) : (
          <div className="text-gray-400 text-sm">No logo</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <div className="text-xl font-bold truncate">{displayName}</div>
          {cleaner.distance_m != null && (
            <div className="text-sm text-gray-500">{km(cleaner.distance_m)}</div>
          )}
        </div>

        {showPayments && cleaner.payment_methods?.length ? (
          <div className="mt-2 text-sm text-gray-600">
            Payments: {cleaner.payment_methods.join(", ")}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 w-44 shrink-0">
        {/* MESSAGE */}
        <button
          type="button"
          className="h-10 rounded-full bg-red-500 text-white font-semibold hover:bg-red-600"
          onClick={async () => {
            // message = whatsapp if present, else phone fallback
            await logClick("click_message");
            if (whatsappHref) window.open(whatsappHref, "_blank", "noopener,noreferrer");
            else if (phoneHref) window.location.href = phoneHref;
          }}
        >
          Message
        </button>

        {/* PHONE */}
        <button
          type="button"
          className="h-10 rounded-full border border-blue-300 text-blue-700 font-semibold hover:bg-blue-50"
          disabled={!phoneHref}
          onClick={async () => {
            await logClick("click_phone");
            if (phoneHref) window.location.href = phoneHref;
          }}
        >
          Phone
        </button>

        {/* WEBSITE */}
        <button
          type="button"
          className="h-10 rounded-full border border-gray-200 text-gray-900 font-semibold hover:bg-gray-50"
          disabled={!websiteHref}
          onClick={async () => {
            await logClick("click_website");
            if (websiteHref) window.open(websiteHref, "_blank", "noopener,noreferrer");
          }}
        >
          Website
        </button>
      </div>
    </div>
  );
}
