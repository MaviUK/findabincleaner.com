// src/components/FindCleaners.tsx
import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export type FindCleanersProps = {
  onSearchComplete?: (results: MatchOut[], postcode: string) => void;
};

// Shape coming from RPC (wide to be safe; adjust if you know exact keys)
type MatchIn = {
  cleaner_id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp?: string | null;
  payment_methods?: unknown;  // could be json/str/csv/null
  service_types?: unknown;    // could be json/str/csv/null
  rating_avg?: number | null;
  rating_count?: number | null;
  distance_m?: number | null; // or distance_meters depending on RPC
};

type MatchOut = {
  cleaner_id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp: string | null;
  payment_methods: string[];
  service_types: string[];
  rating_avg: number | null;
  rating_count: number | null;
  distance_m: number | null;
};

function toArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string") {
    // try JSON array first
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {}
    // fallback CSV
    return v.split(",").map(s => s.trim()).filter(Boolean);
  }
  // last-resort: unknown object -> []
  return [];
}

function formatDistance(m?: number | null) {
  if (typeof m !== "number" || !isFinite(m)) return "";
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}
function toTelHref(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : null;
}
function toWhatsAppHref(phone?: string | null) {
  if (!phone) return null;
  let digits = phone.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (phone.trim().startsWith("+")) {
    digits = phone.replace(/[^\d]/g, "");
  } else if (digits.startsWith("0")) {
    digits = `44${digits.slice(1)}`; // UK normalize 0xxxx -> +44xxxx
  }
  return `https://wa.me/${digits}`;
}

export default function FindCleaners({ onSearchComplete }: FindCleanersProps) {
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MatchOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const submitCount = useRef(0);

  async function lookup(ev?: React.FormEvent) {
    ev?.preventDefault();
    setError(null);
    if (!onSearchComplete) setResults([]);

    const pc = postcode.trim().toUpperCase().replace(/\s+/g, " ");
    if (!pc) return setError("Please enter a postcode.");

    try {
      setLoading(true);
      submitCount.current += 1;

      // 1) Geocode
      const res = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`
      );
      if (!res.ok) throw new Error(`Postcode lookup failed: ${res.status}`);
      const data = await res.json();
      if (data.status !== 200 || !data.result) {
        setError("Postcode not found.");
        return;
      }
      const lat = Number(data.result.latitude);
      const lng = Number(data.result.longitude);

      // 2) RPC – ensure your RPC returns the fields below or equivalent
      const { data: matches, error: rpcError } = await supabase.rpc(
        "find_cleaners_for_point_sorted",
        { lat, lng }
      );

      if (rpcError) {
        setError(rpcError.message);
        return;
      }

      // 3) Normalize to arrays + consistent keys for the rest of the app
      const list: MatchOut[] = (matches as MatchIn[] | null ?? []).map((m) => ({
        cleaner_id: m.cleaner_id,
        business_name: m.business_name ?? null,
        logo_url: m.logo_url ?? null,
        website: m.website ?? null,
        phone: m.phone ?? null,
        whatsapp: m.whatsapp ?? null,
        payment_methods: toArray(m.payment_methods),
        service_types: toArray(m.service_types),
        rating_avg: m.rating_avg ?? null,
        rating_count: m.rating_count ?? null,
        // handle RPCs that return distance_meters instead of distance_m
        distance_m:
          (m as any).distance_meters ?? (m.distance_m ?? null),
      }));

      if (!onSearchComplete) setResults(list);
      onSearchComplete?.(list, pc);
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form className="flex gap-2" onSubmit={lookup}>
        <input
          className="border rounded px-3 py-2 w-full"
          placeholder="Enter postcode (e.g., BT20 5NF)"
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
        />
        <button
          type="submit"
          className="bg-emerald-700 text-white px-4 py-2 rounded"
          disabled={loading}
        >
          {loading ? "Searching…" : "Find cleaners"}
        </button>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">
          {error}
        </div>
      )}

      {/* Local inline list only renders when parent didn't pass onSearchComplete */}
      {!onSearchComplete && (
        <ul className="space-y-2">
          {results.map((r) => {
            const tel = toTelHref(r.phone);
            const wa = toWhatsAppHref(r.phone);
            return (
              <li
                key={r.cleaner_id}
                className="p-4 rounded-xl border flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {r.logo_url ? (
                    <img
                      src={r.logo_url}
                      alt={`${r.business_name ?? "Cleaner"} logo`}
                      className="h-10 w-10 rounded bg-white object-contain border"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-gray-200 border" />
                  )}

                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {r.business_name ?? "Cleaner"}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                      {r.website && (
                        <a
                          href={r.website}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          Website
                        </a>
                      )}
                      {tel && (
                        <a href={tel} className="underline">
                          Call
                        </a>
                      )}
                      {wa && (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-sm text-gray-700 whitespace-nowrap">
                  {formatDistance(r.distance_m ?? undefined)}
                </div>
              </li>
            );
          })}

          {!loading && !error && results.length === 0 && (
            <li className="text-gray-500">No cleaners found yet.</li>
          )}
        </ul>
      )}
    </div>
  );
}
