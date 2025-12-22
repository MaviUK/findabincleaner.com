// src/components/CleanerCard.tsx
import { useMemo } from "react";
import { recordEventBeacon, getOrCreateSessionId } from "../lib/analytics";

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

  /** ✅ must be passed from results row */
  areaId?: string | null;

  /** ✅ must be passed from results row (service category id) */
  categoryId?: string | null;

  showPayments?: boolean;
};

export default function CleanerCard({
  cleaner,
  postcodeHint,
  areaId = null,
  categoryId = null,
}: Props) {
  const name = cleaner.business_name || "Cleaner";

  const websiteHref = useMemo(() => {
    const w = (cleaner.website || "").trim();
    if (!w) return null;
    if (w.startsWith("http://") || w.startsWith("https://")) return w;
    return `https://${w}`;
  }, [cleaner.website]);

  const phoneHref = useMemo(() => {
    const p = (cleaner.phone || "").trim();
    if (!p) return null;
    // keep digits + + only
    const tel = p.replace(/[^\d+]/g, "");
    return tel ? `tel:${tel}` : null;
  }, [cleaner.phone]);

  const whatsappHref = useMemo(() => {
    const w = (cleaner.whatsapp || "").trim();
    if (!w) return null;

    // If it's already a full URL use it
    if (w.startsWith("http://") || w.startsWith("https://")) return w;

    // If it's a number, build wa.me link
    const digits = w.replace(/[^\d]/g, "");
    if (digits) {
      const text = encodeURIComponent(
        `Hi ${name} — I found you on Clean.ly${postcodeHint ? ` (near ${postcodeHint})` : ""}.`
      );
      return `https://wa.me/${digits}?text=${text}`;
    }

    return null;
  }, [cleaner.whatsapp, name, postcodeHint]);

  function logClick(event: "click_message" | "click_phone" | "click_website") {
    try {
      recordEventBeacon({
        cleanerId: cleaner.id,
        event,
        sessionId: getOrCreateSessionId(),
        categoryId: categoryId ?? null,
        areaId: areaId ?? null, // ✅ THIS is the key fix
        meta: {
          source: "results_card",
        },
      });
    } catch (e) {
      console.warn("click log failed", e);
    }
  }

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex gap-5">
        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-gray-100">
          {cleaner.logo_url ? (
            <img
              src={cleaner.logo_url}
              alt={name}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : null}
        </div>

        <div className="flex-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xl font-semibold">{name}</div>
            </div>

            <div className="flex flex-col gap-2 w-44">
              {/* MESSAGE */}
              {whatsappHref ? (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => logClick("click_message")}
                  className="rounded-full bg-red-500 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-red-600"
                >
                  Message
                </a>
              ) : (
                <button
                  disabled
                  className="rounded-full bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-500"
                >
                  Message
                </button>
              )}

              {/* PHONE */}
              {phoneHref ? (
                <a
                  href={phoneHref}
                  onClick={() => logClick("click_phone")}
                  className="rounded-full border px-4 py-2 text-center text-sm font-semibold hover:bg-gray-50"
                >
                  Phone
                </a>
              ) : (
                <button
                  disabled
                  className="rounded-full bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-500"
                >
                  Phone
                </button>
              )}

              {/* WEBSITE */}
              {websiteHref ? (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => logClick("click_website")}
                  className="rounded-full border px-4 py-2 text-center text-sm font-semibold hover:bg-gray-50"
                >
                  Website
                </a>
              ) : (
                <button
                  disabled
                  className="rounded-full bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-500"
                >
                  Website
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
