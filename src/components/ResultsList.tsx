// src/components/ResultsList.tsx
import { useMemo } from "react";
import CleanerCard, { Cleaner } from "./CleanerCard";

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

type Props = {
  cleaners: any[];
  postcode: string;
  locality?: string;
  searchLat?: number | null;
  searchLng?: number | null;
};

export default function ResultsList({
  cleaners,
  postcode,
  locality,
  searchLat = null,
  searchLng = null,
}: Props) {
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
    const sponsored = cleaners.filter((c: any) => !!c.is_covering_sponsor);
    const organic = cleaners.filter((c: any) => !c.is_covering_sponsor);

    // Shuffle organic (stable per postcode/day)
    const seedStr = `${(postcode || "").toUpperCase()}|${new Date()
      .toISOString()
      .slice(0, 10)}`;
    const rng = mulberry32(hashString(seedStr));

    const shuffled = [...organic];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return [...sponsored, ...shuffled];
  }, [cleaners, postcode]);

  const firstSponsoredIndex = ordered.findIndex((c: any) => !!c.is_covering_sponsor);

  return (
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
      {ordered.map((c: any, idx: number) => {
        const cleaner: Cleaner = {
          id: c.id ?? c.cleaner_id,
          business_name: c.business_name,
          logo_url: c.logo_url,
          distance_m: c.distance_meters ?? c.distance_m ?? null,
          website: c.website,
          phone: c.phone,
          whatsapp: c.whatsapp,
          rating_avg: c.rating_avg ?? null,
          rating_count: c.rating_count ?? null,
          payment_methods: toArr(c.payment_methods),
          service_types: toArr(c.service_types),
        };

        const card = (
          <CleanerCard
            key={cleaner.id}
            cleaner={cleaner}
            postcodeHint={postcode}
            showPayments
            areaId={c.area_id ?? null}
            searchLat={searchLat}
            searchLng={searchLng}
          />
        );

        // ✅ first sponsored = full width + highlight
        if (idx === firstSponsoredIndex && !!c.is_covering_sponsor) {
          return (
            <div
              key={cleaner.id}
              className="sm:col-span-2 relative rounded-2xl border border-emerald-200 bg-emerald-50/60 p-2 shadow-sm ring-2 ring-emerald-300"
            >
              <div className="absolute -top-3 left-4 z-10 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow">
                Sponsored • Featured #1
              </div>
              {card}
            </div>
          );
        }

        return <div key={cleaner.id}>{card}</div>;
      })}
    </div>
  );
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
