// src/components/ResultsList.tsx
import { useMemo } from "react";
import CleanerCard from "./CleanerCard";

type Props = {
  cleaners: any[];
  postcode: string;
  locality?: string;

  // ✅ NEW: pass the current search context down so clicks/impressions are attributed correctly
  areaId?: string | null;
  categoryId?: string | null;
};

function truthy(v: any) {
  return v === true || v === 1 || v === "1" || v === "true" || v === "t" || v === "yes";
}

function isSponsored(c: any) {
  if (truthy(c?.is_covering_sponsor)) return true;

  return !!(
    truthy(c?.is_sponsored) ||
    truthy(c?.sponsored) ||
    truthy(c?.sponsor_active) ||
    truthy(c?.sponsorship_active) ||
    c?.priority === 1 ||
    c?.rank === 1
  );
}

function toArr(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {}
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function hashString(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function ResultsList({ cleaners, postcode, locality, areaId, categoryId }: Props) {
  if (!cleaners?.length) {
    const pc = postcode?.toUpperCase?.() || "your area";
    return (
      <p className="text-center text-gray-600 mt-6">
        No cleaners found near {pc}
        {locality ? `, in ${locality}` : ""}.
      </p>
    );
  }

  const ordered = useMemo(() => {
    const sponsored = (cleaners ?? []).filter(isSponsored);
    const organic = (cleaners ?? []).filter((c) => !isSponsored(c));

    // Shuffle organic (stable per postcode/day)
    const seedStr = `${(postcode || "").toUpperCase()}|${new Date().toISOString().slice(0, 10)}`;
    const rng = mulberry32(hashString(seedStr));

    const shuffled = [...organic];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return [...sponsored, ...shuffled];
  }, [cleaners, postcode]);

  const firstSponsoredIndex = ordered.findIndex(isSponsored);

  return (
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
      {ordered.map((c: any, idx: number) => {
        const cleanerId = c.cleaner_id ?? c.id;

        const cleaner = {
          cleaner_id: cleanerId,
          id: cleanerId,
          business_name: c.business_name ?? "Cleaner",
          logo_url: c.logo_url ?? null,
          distance_m: c.distance_meters ?? c.distance_m ?? null,
          website: c.website ?? null,
          phone: c.phone ?? null,
          whatsapp: c.whatsapp ?? null,
          rating_avg: c.rating_avg ?? null,
          rating_count: c.rating_count ?? null,
          payment_methods: toArr(c.payment_methods),
          service_types: toArr(c.service_types),

          // keep these on the cleaner too, but we will pass explicit props as the source of truth
          area_id: c.area_id ?? null,
          category_id: c.category_id ?? null,
        };

        // ✅ IMPORTANT: always pass the current search categoryId so clicks are attributed to the industry
        const card = (
          <CleanerCard
            key={cleanerId}
            cleaner={cleaner as any}
            postcodeHint={postcode}
            showPayments
            position={idx + 1}
            areaId={areaId ?? c.area_id ?? null}
            categoryId={categoryId ?? c.category_id ?? null}
          />
        );

        const isFirstSponsored = idx === firstSponsoredIndex && isSponsored(c);

        if (isFirstSponsored) {
          return (
            <div
              key={cleanerId}
              className="sm:col-span-2 relative rounded-2xl border border-emerald-200 bg-emerald-50/60 p-2 shadow-sm ring-2 ring-emerald-300"
            >
              <div className="absolute -top-3 left-4 z-10 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow">
                Sponsored • Featured #1
              </div>
              {card}
            </div>
          );
        }

        return <div key={cleanerId}>{card}</div>;
      })}
    </div>
  );
}
