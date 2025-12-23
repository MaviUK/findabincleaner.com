// src/components/CleanerCard.tsx
import { useMemo } from "react";
import { recordEventBeacon, getOrCreateSessionId } from "../lib/analytics";
import type { MatchOut } from "./FindCleaners";

export type CleanerCardProps = {
  cleaner: MatchOut;
  postcodeHint: string;
  locality?: string;
  areaId: string | null;
  categoryId: string | null;
  searchLat: number | null;
  searchLng: number | null;
};

function normalizeWebsite(url: string): string {
  const u = url.trim();
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return `https://${u}`;
}

export default function CleanerCard({
  cleaner,
  postcodeHint,
  locality,
  areaId,
  categoryId,
  searchLat,
  searchLng,
}: CleanerCardProps) {
  const websiteHref = useMemo(() => {
    if (!cleaner.website) return "";
    return normalizeWebsite(cleaner.website);
  }, [cleaner.website]);

  async function logClick(event: "click_message" | "click_phone" | "click_website") {
    await recordEventBeacon({
      cleanerId: cleaner.cleaner_id,
      areaId,
      categoryId,
      event,
      sessionId: getOrCreateSessionId(),
      meta: {
        postcode: postcodeHint,
        locality,
        search_lat: searchLat,
        search_lng: searchLng,
      },
    });
  }

  const whatsappLink = useMemo(() => {
    if (!cleaner.whatsapp) return "";
    // allow full wa.me links OR plain numbers
    const raw = cleaner.whatsapp.trim();
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    const digits = raw.replace(/[^\d+]/g, "");
    return `https://wa.me/${digits.replace(/^\+/, "")}`;
  }, [cleaner.whatsapp]);

  const phoneLink = cleaner.phone ? `tel:${cleaner.phone.replace(/\s+/g, "")}` : "";

  return (
    <div className="rounded-2xl border border-black/5 bg-white shadow-sm p-4 sm:p-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <div className="h-20 w-28 rounded-2xl bg-gray-100 overflow-hidden shrink-0">
          {cleaner.logo_url ? (
            <img
              src={cleaner.logo_url}
              alt={cleaner.business_name || "Cleaner"}
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="text-lg font-bold truncate">
            {cleaner.business_name || "Cleaner"}
          </div>
          <div className="text-sm text-gray-500">
            {typeof cleaner.distance_m === "number"
              ? `${(cleaner.distance_m / 1000).toFixed(1)} km`
              : ""}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 shrink-0 w-44">
        {/* Message */}
        {whatsappLink ? (
          <a
            className="h-10 rounded-full bg-red-500 text-white font-semibold flex items-center justify-center"
            href={whatsappLink}
            target="_blank"
            rel="noreferrer"
            onClick={() => logClick("click_message")}
          >
            Message
          </a>
        ) : (
          <button
            className="h-10 rounded-full bg-gray-200 text-gray-600 font-semibold"
            disabled
          >
            Message
          </button>
        )}

        {/* Phone */}
        {phoneLink ? (
          <a
            className="h-10 rounded-full border border-blue-300 text-blue-700 font-semibold flex items-center justify-center"
            href={phoneLink}
            onClick={() => logClick("click_phone")}
          >
            Phone
          </a>
        ) : (
          <button
            className="h-10 rounded-full bg-gray-200 text-gray-600 font-semibold"
            disabled
          >
            Phone
          </button>
        )}

        {/* Website */}
        {websiteHref ? (
          <a
            className="h-10 rounded-full border border-gray-200 text-gray-900 font-semibold flex items-center justify-center"
            href={websiteHref}
            target="_blank"
            rel="noreferrer"
            onClick={() => logClick("click_website")}
          >
            Website
          </a>
        ) : (
          <button
            className="h-10 rounded-full bg-gray-200 text-gray-600 font-semibold"
            disabled
          >
            Website
          </button>
        )}
      </div>
    </div>
  );
}
