// src/components/CleanerCard.tsx
import { getOrCreateSessionId, recordEventBeacon } from "../lib/analytics";

export type Cleaner = {
  cleaner_id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp: string | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  distance_m?: number | null;
  area_id?: string | null;
  category_id?: string | null;
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;
  showPayments?: boolean;
};

function normalizeWebsite(url: string): string {
  const u = url.trim();
  if (!u) return u;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return `https://${u}`;
}

export default function CleanerCard({ cleaner }: Props) {
  const sessionId = getOrCreateSessionId();

  const areaId = cleaner.area_id ?? null;
  const categoryId = cleaner.category_id ?? null;

  const onClickMessage = () => {
    recordEventBeacon({
      event: "click_message",
      cleanerId: cleaner.cleaner_id,
      areaId,
      categoryId,
      sessionId,
    });

    // if whatsapp exists, use it, else fallback to tel if phone exists
    if (cleaner.whatsapp) {
      window.open(cleaner.whatsapp, "_blank", "noopener,noreferrer");
      return;
    }
    if (cleaner.phone) {
      window.location.href = `tel:${cleaner.phone}`;
    }
  };

  const onClickPhone = () => {
    recordEventBeacon({
      event: "click_phone",
      cleanerId: cleaner.cleaner_id,
      areaId,
      categoryId,
      sessionId,
    });

    if (cleaner.phone) window.location.href = `tel:${cleaner.phone}`;
  };

  const onClickWebsite = () => {
    recordEventBeacon({
      event: "click_website",
      cleanerId: cleaner.cleaner_id,
      areaId,
      categoryId,
      sessionId,
    });

    if (cleaner.website) {
      window.open(normalizeWebsite(cleaner.website), "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm flex items-center gap-4">
      <div className="h-24 w-24 rounded-2xl overflow-hidden bg-gray-100 shrink-0">
        {cleaner.logo_url ? (
          <img src={cleaner.logo_url} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <div className="text-lg font-semibold truncate">
            {cleaner.business_name || "Business"}
          </div>
          {typeof cleaner.distance_m === "number" && (
            <div className="text-xs text-gray-500">
              {(cleaner.distance_m / 1000).toFixed(1)} km
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 w-40">
        <button
          onClick={onClickMessage}
          className="h-10 rounded-full bg-red-500 text-white font-semibold"
          type="button"
        >
          Message
        </button>
        <button
          onClick={onClickPhone}
          className="h-10 rounded-full border border-blue-300 text-blue-700 font-semibold"
          type="button"
          disabled={!cleaner.phone}
        >
          Phone
        </button>
        <button
          onClick={onClickWebsite}
          className="h-10 rounded-full border border-black/10 text-gray-900 font-semibold"
          type="button"
          disabled={!cleaner.website}
        >
          Website
        </button>
      </div>
    </div>
  );
}
