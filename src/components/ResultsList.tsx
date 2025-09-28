// src/components/ResultsList.tsx
import CleanerCard, { Cleaner } from "./CleanerCard";

type Props = { cleaners: any[]; postcode: string };

// Normalise unknown -> string[]
function toArr(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string") {
    // Try JSON array first: '["cash","stripe"]'
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {}
    // Fallback CSV: "cash,stripe"
    return v.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
}

export default function ResultsList({ cleaners, postcode }: Props) {
  if (!cleaners?.length) {
    return (
      <p className="text-center text-gray-600 mt-6">
        No cleaners found near {postcode?.toUpperCase?.() || "your area"}.
      </p>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      {cleaners.map((c) => {
        const cleaner: Cleaner = {
          id: c.id ?? c.cleaner_id,
          business_name: c.business_name,
          logo_url: c.logo_url ?? null,
          distance_m: c.distance_meters ?? c.distance_m ?? null,
          website: c.website ?? null,
          phone: c.phone ?? null,
          whatsapp: c.whatsapp ?? null,
          rating_avg: c.rating_avg ?? null,
          rating_count: c.rating_count ?? null,
          // Ensure arrays so CleanerCard renders Services + Payments like the Profile preview
          payment_methods: toArr(
            c.payment_methods ??
            c.payment_methods_accepted ??
            c.payments
          ),
          service_types: toArr(
            c.service_types ??
            c.services ??
            c.service_types_supported
          ),
        };

        return (
          <CleanerCard
            key={cleaner.id}
            cleaner={cleaner}
            postcodeHint={postcode}
            showPayments
          />
        );
      })}
    </div>
  );
}
