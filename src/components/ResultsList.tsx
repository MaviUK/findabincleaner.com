// src/components/ResultsList.tsx
import { useMemo } from "react";
import CleanerCard from "./CleanerCard";

type Props = {
  cleaners: any[];
  postcode: string;
  locality?: string;
};

function isSponsored(c: any) {
  // Be tolerant to different backend flag names
  return !!(
    c?.is_covering_sponsor ||
    c?.is_sponsored ||
    c?.sponsored ||
    c?.isSponsor ||
    c?.sponsor ||
    c?.sponsor_active ||
    c?.sponsorship_active ||
    c?.priority === 1 ||
    c?.rank === 1
  );
}

export default function ResultsList({ cleaners, postcode }: Props) {
  if (!cleaners?.length) return null;

  const { sponsored, organic } = useMemo(() => {
    const sponsored = (cleaners ?? []).filter(isSponsored);
    const organic = (cleaners ?? []).filter((c) => !isSponsored(c));

    // Deterministic shuffle: stable for same postcode + day
    const seedStr = `${(postcode || "").toUpperCase()}|${new Date()
      .toISOString()
      .slice(0, 10)}`;
    const rng = mulberry32(hashString(seedStr));

    const shuffled = [...organic];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return { sponsored, organic: shuffled };
  }, [cleaners, postcode]);

  // #1 sponsored should be full width + highlighted
  const sponsoredFirst = sponsored[0] ?? null;
  const sponsoredRest = sponsored.length > 1 ? sponsored.slice(1) : [];

  const renderCard = (c: any) => {
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
      payment_methods: normaliseArr(c.payment_methods),
      service_types: normaliseArr(c.service_types),
    };

    return (
      <CleanerCard
        key={cleanerId}
        cleaner={cleaner as any}
        postcodeHint={postcode}
        showPayments
        areaId={c.area_id ?? null}
      />
    );
  };

  return (
    <div className="mt-4 space-y-4">
      {/* Full-width + highlighted #1 sponsored */}
      {sponsoredFirst && (
        <div className="relative">
          <div className="absolute -top-3 left-4 z-10 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow">
            Sponsored • #1 in this area
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-2 shadow-sm ring-2 ring-emerald-300">
            {renderCard(sponsoredFirst)}
          </div>
        </div>
      )}

      {/* Remaining sponsored (still before organic) */}
      {sponsoredRest.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {sponsoredRest.map((c) => (
            <div
              key={c.cleaner_id ?? c.id}
              className="rounded-2xl border border-emerald-100 bg-emerald-50/30 p-2"
            >
              {renderCard(c)}
            </div>
          ))}
        </div>
      )}

      {/* Organic results: 2-up */}
      {organic.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {organic.map(renderCard)}
        </div>
      )}
    </div>
  );
}

function normaliseArr(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed;
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
