// src/components/CleanerCard.tsx
import { useMemo } from "react";
import { recordEventBeacon } from "../lib/analytics";

export type Cleaner = {
  id: string;
  business_name: string | null;
  logo_url: string | null;
  distance_m: number | null;
  website: string | null;
  phone: string | null;
  whatsapp?: string | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  payment_methods?: string[];
  service_types?: string[];
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;
  showPayments?: boolean;
  areaId?: string | null;
  categoryId?: string | null;
  searchLat?: number | null;
  searchLng?: number | null;
};

function fmtDistance(m: number | null) {
  if (m == null) return null;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function normalizeWebsite(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

function toWhatsAppLink(raw: string, text: string) {
  const digits = raw.replace(/[^\d+]/g, "");
  const phone = digits.startsWith("+") ? digits : `+44${digits.replace(/^0/, "")}`;
  const msg = encodeURIComponent(text);
  return `https://wa.me/${phone.replace("+", "")}?text=${msg}`;
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
  const distanceLabel = useMemo(() => fmtDistance(cleaner.distance_m), [cleaner.distance_m]);

  async function log(event: "click_message" | "click_phone" | "click_website") {
    await recordEventBeacon({
      cleanerId: cleaner.id,
      event,
      categoryId,
      areaId,
      meta: {
        postcode_hint: postcodeHint ?? null,
        search_lat: searchLat ?? null,
        search_lng: searchLng ?? null,
      },
    });
  }

  const msgText = `Hi! I found you on Clean.ly${postcodeHint ? ` (search: ${postcodeHint})` : ""}. Can I get a quote?`;

  const onMessage = async () => {
    if (!cleaner.whatsapp) return;
    try { await log("click_message"); } catch {}
    window.open(toWhatsAppLink(cleaner.whatsapp, msgText), "_blank", "noopener,noreferrer");
  };

  const onPhone = async () => {
    if (!cleaner.phone) return;
    try { await log("click_phone"); } catch {}
    window.location.href = `tel:${cleaner.phone}`;
  };

  const onWebsite = async () => {
    if (!cleaner.website) return;
    try { await log("click_website"); } catch {}
    window.open(normalizeWebsite(cleaner.website), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="h-24 w-24 rounded-2xl bg-gray-100 overflow-hidden shrink-0">
            {cleaner.logo_url ? (
              <img
                src={cleaner.logo_url}
                alt={cleaner.business_name ?? "Cleaner"}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : null}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-bold truncate">{cleaner.business_name ?? "Unnamed cleaner"}</h3>
              {distanceLabel ? <span className="text-sm text-gray-500 shrink-0">{distanceLabel}</span> : null}
            </div>

            {showPayments && cleaner.payment_methods?.length ? (
              <div className="mt-2 text-sm text-gray-700 truncate">
                <span className="font-medium">Payments:</span> {cleaner.payment_methods.join(", ")}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2 w-40 shrink-0">
          <button
            onClick={onMessage}
            disabled={!cleaner.whatsapp}
            className={`h-10 rounded-full text-sm font-semibold ${
              cleaner.whatsapp ? "bg-red-500 text-white hover:bg-red-600" : "bg-gray-200 text-gray-500 cursor-not-allowed"
            }`}
          >
            Message
          </button>

          <button
            onClick={onPhone}
            disabled={!cleaner.phone}
            className={`h-10 rounded-full text-sm font-semibold border ${
              cleaner.phone ? "border-blue-300 text-blue-700 hover:bg-blue-50" : "border-gray-200 text-gray-500 cursor-not-allowed"
            }`}
          >
            Phone
          </button>

          <button
            onClick={onWebsite}
            disabled={!cleaner.website}
            className={`h-10 rounded-full text-sm font-semibold border ${
              cleaner.website ? "border-gray-200 text-gray-800 hover:bg-gray-50" : "border-gray-200 text-gray-500 cursor-not-allowed"
            }`}
          >
            Website
          </button>
        </div>
      </div>
    </div>
  );
}
