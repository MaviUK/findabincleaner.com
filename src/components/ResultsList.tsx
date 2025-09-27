import CleanerCard from "./CleanerCard"; // <-- ResultsList.tsx is in the same folder as CleanerCard.tsx
// If your CleanerCard is actually at ../components/CleanerCard, adjust accordingly.

export default function ResultsList({
  cleaners,
  postcode,
}: {
  cleaners: any[];
  postcode: string;
}) {
  if (!cleaners?.length) {
    return (
      <p className="text-center text-gray-600 mt-6">
        No cleaners found near {postcode?.toUpperCase?.() || "your area"}.
      </p>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      {cleaners.map((c) => (
        <CleanerCard
          key={c.id}
         // inside ResultsList.tsx when passing to <CleanerCard />
cleaner={{
  id: c.id ?? c.cleaner_id,               // <-- add fallback
  business_name: c.business_name,
  logo_url: c.logo_url,
  distance_m: c.distance_meters ?? c.distance_m ?? null,
  website: c.website,
  phone: c.phone,
  whatsapp: c.whatsapp,
  rating_avg: c.rating_avg ?? null,
  rating_count: c.rating_count ?? null,
  payment_methods: c.payment_methods ?? [],
}}
          postcodeHint={postcode}
        />
      ))}
    </div>
  );
}
