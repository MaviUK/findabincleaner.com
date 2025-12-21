// src/components/ResultsList.tsx
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

  /** ✅ current industry category id (optional, but needed for per-industry analytics) */
  categoryId?: string | null;
};

export default function ResultsList({
  cleaners,
  postcode,
  locality,
  searchLat = null,
  searchLng = null,
  categoryId = null,
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

  return (
    <div className="space-y-4 mt-4">
      {cleaners.map((c) => {
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
            /* IMPORTANT: gives clicks the correct area */
            areaId={c.area_id ?? null}
            /* Fallback so DB can determine area if areaId missing */
            searchLat={searchLat}
            searchLng={searchLng}
            /* ✅ ensures clicks are attributed to the selected industry */
            categoryId={c.category_id ?? categoryId ?? null}
          />
        );
      })}
    </div>
  );
}
