// src/components/ResultsList.tsx
import CleanerCard from "./CleanerCard";
import type { MatchOut, ServiceSlug } from "./FindCleaners";

export default function ResultsList({
  results,
  postcode,
  serviceSlug,
}: {
  results: MatchOut[];
  postcode: string;
  serviceSlug: ServiceSlug;
}) {
  if (!results.length) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500">
            Results
          </div>
          <div className="text-lg font-bold text-gray-900">
            {results.length} businesses near {postcode}
          </div>
        </div>

        <div className="text-xs text-gray-500">
          {serviceSlug === "bin-cleaner"
            ? "Bin Cleaner"
            : serviceSlug === "window-cleaner"
              ? "Window Cleaner"
              : "Cleaner"}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {results.map((c) => (
          <CleanerCard
            key={c.cleaner_id}
            cleaner={{
              cleaner_id: c.cleaner_id,
              business_name: c.business_name,
              logo_url: c.logo_url,
              website: c.website,
              phone: c.phone,
              whatsapp: c.whatsapp,

              area_id: c.area_id ?? null,
              area_name: c.area_name ?? null,
              category_id: c.category_id ?? null,
              is_covering_sponsor: Boolean(c.is_covering_sponsor),

              google_rating: c.google_rating ?? null,
              google_reviews_count: c.google_reviews_count ?? null,
            }}
          />
        ))}
      </div>
    </div>
  );
}
