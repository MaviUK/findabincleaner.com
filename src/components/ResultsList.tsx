// src/components/ResultsList.tsx
import CleanerCard from "./CleanerCard";
import type { MatchOut } from "./FindCleaners";

export type ResultsListProps = {
  cleaners: MatchOut[];
  postcode: string;
  locality: string;
  searchLat: number | null;
  searchLng: number | null;
};

export default function ResultsList({
  cleaners,
  postcode,
  locality,
  searchLat,
  searchLng,
}: ResultsListProps) {
  return (
    <div className="space-y-4">
      {cleaners.map((c) => (
        <CleanerCard
          key={c.cleaner_id}
          cleaner={c}
          postcodeHint={postcode}
          locality={locality}
          areaId={c.area_id ?? null}
          categoryId={c.category_id ?? null}
          searchLat={searchLat}
          searchLng={searchLng}
        />
      ))}
    </div>
  );
}
