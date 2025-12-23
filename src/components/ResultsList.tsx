// src/components/ResultsList.tsx
import CleanerCard, { type Cleaner } from "./CleanerCard";

type Props = {
  cleaners: any[];
  postcode?: string;
  locality?: string;
};

export default function ResultsList({ cleaners, postcode, locality }: Props) {
  const list = (cleaners || []) as any[];

  return (
    <div className="space-y-3">
      {list.map((c, idx) => {
        // Normalize whatever your RPC returns into the CleanerCard "Cleaner" type
        const cleaner: Cleaner = {
          cleaner_id: c.cleaner_id ?? c.id ?? "", // prefer cleaner_id
          business_name: c.business_name ?? c.name ?? null,
          logo_url: c.logo_url ?? null,
          website: c.website ?? null,
          phone: c.phone ?? null,
          whatsapp: c.whatsapp ?? null,
          rating_avg: c.rating_avg ?? null,
          rating_count: c.rating_count ?? null,
          distance_m: c.distance_m ?? c.distance_meters ?? null,
          area_id: c.area_id ?? null,
          category_id: c.category_id ?? null,
        };

        // Safety: skip broken rows
        if (!cleaner.cleaner_id) return null;

        return (
          <CleanerCard
            key={`${cleaner.cleaner_id}-${idx}`}
            cleaner={cleaner}
            postcodeHint={postcode || locality || ""}
            showPayments={true}
          />
        );
      })}

      {list.length === 0 && (
        <div className="rounded-xl border border-black/10 bg-white p-4 text-sm text-gray-600">
          No results yet — try searching a postcode.
        </div>
      )}
    </div>
  );
}
