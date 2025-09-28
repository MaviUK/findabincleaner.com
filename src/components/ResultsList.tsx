// src/components/ResultsList.tsx
import CleanerCard, { Cleaner } from "./CleanerCard";

type Props = {
  cleaners: any[];
  postcode: string;
};

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
          logo_url: c.logo_url,
          distance_m: c.distance_meters ?? c.distance_m ?? null,
          website: c.website,
          phone: c.phone,
          whatsapp: c.whatsapp,
          rating_avg: c.rating_avg ?? null,
          rating_count: c.rating_count ?? null,
          // ✅ ensure these arrays are present so the card renders Services + Payments
          payment_methods: c.payment_methods ?? [],
          service_types: c.service_types ?? [],    // <-- add this
        };

        return (
          <CleanerCard
            key={cleaner.id}
            cleaner={cleaner}
            postcodeHint={postcode}
            showPayments={true}
          />
        );
      })}
    </div>
  );
}
