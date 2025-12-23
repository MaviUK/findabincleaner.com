// src/components/ResultsList.tsx
import CleanerCard from "./CleanerCard";

type Cleaner = {
  cleaner_id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp?: string | null;
  distance_m?: number | null;

  area_id?: string | null;
  area_name?: string | null;
  category_id?: string | null;

  is_covering_sponsor?: boolean;
};

type Props = {
  cleaners: Cleaner[];
  postcode: string;
  locality: string;
};

export default function ResultsList({ cleaners }: Props) {
  const sponsored = cleaners.filter((c) => Boolean(c.is_covering_sponsor));
  const normal = cleaners.filter((c) => !c.is_covering_sponsor);

  return (
    <div className="space-y-4">
      {/* Sponsored (full width) */}
      {sponsored.length > 0 && (
        <div className="space-y-3">
          {sponsored.map((c, idx) => (
            <CleanerCard
              key={`s-${c.cleaner_id}`}
              cleaner={c}
              areaId={c.area_id ?? null}
              categoryId={c.category_id ?? null}
              position={idx + 1}
            />
          ))}
        </div>
      )}

      {/* Normal (two columns) */}
      {normal.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {normal.map((c, idx) => (
            <CleanerCard
              key={`n-${c.cleaner_id}`}
              cleaner={c}
              areaId={c.area_id ?? null}
              categoryId={c.category_id ?? null}
              position={sponsored.length + idx + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
