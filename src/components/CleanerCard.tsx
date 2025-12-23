// src/components/CleanerCard.tsx
import { recordEventFromPointBeacon, getOrCreateSessionId } from "../lib/analytics";

export type Cleaner = {
  id: string;
  business_name: string | null;
  logo_url: string | null;
  distance_m: number | null;
  website: string | null;
  phone: string | null;
  whatsapp: string | null;
  rating_avg: number | null;
  rating_count: number | null;
  payment_methods?: string[];
  service_types?: string[];
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;
  showPayments?: boolean;

  // analytics attribution
  areaId?: string | null;
  categoryId?: string | null;

  // fallback point for backend area lookup
  searchLat?: number | null;
  searchLng?: number | null;
};

function kmFromMeters(m?: number | null) {
  if (!m && m !== 0) return null;
  return (m / 1000).toFixed(1);
}

function normalizeUrl(url: string) {
  const u = url.trim();
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return `https://${u}`;
}

function normalizePhone(p: string) {
  return p.replace(/[^\d+]/g, "");
}

function buildWhatsAppLink(whatsapp: string, businessName?: string | null, postcodeHint?: string) {
  const num = normalizePhone(whatsapp);
  const text = `Hi${businessName ? ` ${businessName}` : ""}! I found you on Clean.ly${
    postcodeHint ? ` (search: ${postcodeHint.toUpperCase()})` : ""
  }. Are you available?`;
  return `https://wa.me/${encodeURIComponent(num)}?text=${encodeURIComponent(text)}`;
}

export default function CleanerCard({
  cleaner,
  postcodeHint,
  showPayments = true,
  areaId = null,
  categoryId = null,
  searchLat = null,
  searchLng = null,
}: Props) {
  const distanceKm = kmFromMeters(cleaner.distance_m);

  async function logClick(event: "click_message" | "click_website" | "click_phone") {
    try {
      const sessionId = getOrCreateSessionId();
      await recordEventFromPointBeacon({
        cleanerId: cleaner.id,
        event,
        sessionId,
        categoryId,
        areaId,
        lat: searchLat,
        lng: searchLng,
        meta: {
          postcode: postcodeHint ?? null,
          area_id: areaId ?? null,
        },
      });
    } catch (e) {
      console.warn("click log failed", e);
    }
  }

  const hasWhatsApp = Boolean(cleaner.whatsapp);
  const hasPhone = Boolean(cleaner.phone);
  const hasWebsite = Boolean(cleaner.website);

  const websiteHref = cleaner.website ? normalizeUrl(cleaner.website) : "";
  const phoneHref = cleaner.phone ? `tel:${normalizePhone(cleaner.phone)}` : "";
  const waHref = cleaner.whatsapp ? buildWhatsAppLink(cleaner.whatsapp, cleaner.business_name, postcodeHint) : "";

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 overflow-hidden rounded-2xl bg-black/5 shrink-0">
          {cleaner.logo_url ? (
            <img src={cleaner.logo_url} alt={cleaner.business_name ?? "Cleaner"} className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <div className="text-lg font-semibold truncate">{cleaner.business_name ?? "Cleaner"}</div>
            {distanceKm ? <div className="text-sm text-gray-500">{distanceKm} km</div> : null}
          </div>

          {showPayments && cleaner.payment_methods?.length ? (
            <div className="mt-1 text-xs text-gray-500">
              Payments: {cleaner.payment_methods.join(", ")}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 w-40">
          {/* MESSAGE */}
          {hasWhatsApp ? (
            <a
              href={waHref}
              target="_blank"
              rel="noreferrer"
              onClick={() => logClick("click_message")}
              className="h-10 rounded-full bg-red-500 text-white font-semibold text-sm flex items-center justify-center"
            >
              Message
            </a>
          ) : (
            <button
              disabled
              className="h-10 rounded-full bg-gray-200 text-gray-500 font-semibold text-sm"
            >
              Message
            </button>
          )}

          {/* PHONE */}
          {hasPhone ? (
            <a
              href={phoneHref}
              onClick={() => logClick("click_phone")}
              className="h-10 rounded-full border border-blue-300 text-blue-700 font-semibold text-sm flex items-center justify-center"
            >
              Phone
            </a>
          ) : (
            <button
              disabled
              className="h-10 rounded-full bg-gray-200 text-gray-500 font-semibold text-sm"
            >
              Phone
            </button>
          )}

          {/* WEBSITE */}
          {hasWebsite ? (
            <a
              href={websiteHref}
              target="_blank"
              rel="noreferrer"
              onClick={() => logClick("click_website")}
              className="h-10 rounded-full border border-black/10 text-sm font-semibold flex items-center justify-center"
            >
              Website
            </a>
          ) : (
            <button
              disabled
              className="h-10 rounded-full bg-gray-200 text-gray-500 font-semibold text-sm"
            >
              Website
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
