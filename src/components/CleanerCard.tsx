// src/components/CleanerCard.tsx
import { getOrCreateSessionId, recordEvent } from "../lib/analytics";

export type Cleaner = {
  id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp?: string | null;
  rating_avg?: number | null;
  rating_count?: number | null;
  distance_m?: number | null;
  payment_methods?: string[];
  service_types?: string[];
};

type Props = {
  cleaner: Cleaner;
  postcodeHint?: string;

  showPayments?: boolean;

  // used for analytics attribution
  areaId?: string | null;
  categoryId?: string | null;
};

export default function CleanerCard({
  cleaner,
  postcodeHint,
  showPayments = true,
  areaId = null,
  categoryId = null,
}: Props) {
  const sessionId = getOrCreateSessionId();

  async function logClick(event: "click_message" | "click_phone" | "click_website") {
    await recordEvent({
      cleanerId: cleaner.id,
      event,
      sessionId,
      categoryId,
      areaId,
      meta: {
        postcode_hint: postcodeHint ?? null,
      },
    });
  }

  const canMessage = Boolean(cleaner.whatsapp);
  const canPhone = Boolean(cleaner.phone);
  const canWebsite = Boolean(cleaner.website);

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 overflow-hidden rounded-xl bg-gray-100 shrink-0">
          {cleaner.logo_url ? (
            <img
              src={cleaner.logo_url}
              alt={cleaner.business_name ?? "Cleaner"}
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold truncate">
            {cleaner.business_name ?? "Cleaner"}
          </div>

          {typeof cleaner.distance_m === "number" ? (
            <div className="text-sm text-gray-600">
              {(cleaner.distance_m / 1000).toFixed(1)} km
            </div>
          ) : null}

          {showPayments && cleaner.payment_methods?.length ? (
            <div className="mt-2 text-xs text-gray-600">
              Payments: {cleaner.payment_methods.join(", ")}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 w-44">
          <button
            className="h-10 rounded-full bg-red-500 text-white font-semibold disabled:opacity-40"
            disabled={!canMessage}
            onClick={async () => {
              await logClick("click_message");
              if (cleaner.whatsapp) window.open(cleaner.whatsapp, "_blank");
            }}
          >
            Message
          </button>

          <button
            className="h-10 rounded-full border border-blue-300 text-blue-700 font-semibold disabled:opacity-40"
            disabled={!canPhone}
            onClick={async () => {
              await logClick("click_phone");
              if (cleaner.phone) window.location.href = `tel:${cleaner.phone}`;
            }}
          >
            Phone
          </button>

          <button
            className="h-10 rounded-full border border-gray-200 font-semibold disabled:opacity-40"
            disabled={!canWebsite}
            onClick={async () => {
              await logClick("click_website");
              if (cleaner.website) window.open(cleaner.website, "_blank");
            }}
          >
            Website
          </button>
        </div>
      </div>
    </div>
  );
}
