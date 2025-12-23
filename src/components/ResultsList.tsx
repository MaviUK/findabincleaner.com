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
  /** Pass these from the page that did the postcode → lat/lng lookup */
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

  // --- Ordering rules ---
  // 1) Any covering sponsors always appear first
  // 2) Everyone else is shuffled (random order) for fairness
  const { sponsored, organic } = useMemo(() => {
    const sponsored = (cleaners ?? []).filter((c) => !!c.is_covering_sponsor);
    const organic = (cleaners ?? []).filter((c) => !c.is_covering_sponsor);

    // Deterministic shuffle: stable for a given postcode + current date (so it
    // doesn't re-randomise on every re-render), but changes day-to-day and per postcode.
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

  // First paid result is full-width; remaining paid results are 2-up.
  const sponsoredFirst = sponsored[0] ?? null;
  const sponsoredRest = sponsored.length > 1 ? sponsored.slice(1) : [];

  const renderCard = (c: any) => {
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
      payment_methods: toArr(
        c.payment_methods ?? c.payment_methods_accepted ?? c.payments
      ),
      service_types: toArr(
        c.service_types ?? c.services ?? c.service_types_supported
      ),
    };

    return (
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
  };

  return (
    <div className="mt-4 space-y-4">
      {/* Sponsored results: first position is always full width */}
      {sponsoredFirst && <div>{renderCard(sponsoredFirst)}</div>}

      {/* Any additional sponsored listings: still above organic, but 2-up on desktop */}
      {sponsoredRest.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {sponsoredRest.map(renderCard)}
        </div>
      )}

      {/* Organic results: shuffled, displayed 2-up on desktop */}
      {organic.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {organic.map(renderCard)}
        </div>
      )}
    </div>
  );
}

function hashString(str: string) {
  // Small string hash → 32-bit int
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
