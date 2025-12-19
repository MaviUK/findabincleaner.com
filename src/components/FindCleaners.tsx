// src/components/FindCleaners.tsx
import { useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import {
  recordEvent,
  recordEventFromPointBeacon,
  getOrCreateSessionId,
} from "../lib/analytics";

export type ServiceSlug = "bin-cleaner" | "window-cleaner" | "cleaner";

export type FindCleanersProps = {
  serviceSlug: ServiceSlug;
  onSearchComplete?: (
    results: MatchOut[],
    postcode: string,
    locality?: string,
    lat?: number,
    lng?: number
  ) => void;
};

type MatchIn = {
  cleaner_id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp?: string | null;
  payment_methods?: unknown;
  service_types?: unknown;
  rating_avg?: number | null;
  rating_count?: number | null;
  distance_meters?: number | null;
  area_id?: string | null;
  area_name?: string | null;
  is_covering_sponsor?: boolean | null;
};

export type MatchOut = {
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
  area_id: string | null;
  area_name?: string | null;
  is_covering_sponsor?: boolean;
};

function toArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {}
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

const FRIENDLY_BAD_POSTCODE =
  "Hmm… we couldn’t recognise that postcode.\nDouble-check it or try a nearby postcode.";

export default function FindCleaners({
  onSearchComplete,
  serviceSlug,
}: FindCleanersProps) {
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MatchOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const submitCount = useRef(0);

  async function lookup(ev?: FormEvent) {
    ev?.preventDefault();
    setError(null);
    if (!onSearchComplete) setResults([]);

    const pc = postcode.trim().toUpperCase().replace(/\s+/g, " ");
    if (!pc) {
      setError("Please enter a postcode.");
      return;
    }

    try {
      setLoading(true);
      submitCount.current += 1;

      // 1) Geocode postcode (postcodes.io)
      const res = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`
      );

      // Friendly message for non-existent postcodes
      if (!res.ok) {
        if (res.status === 404) {
          setError(FRIENDLY_BAD_POSTCODE);
          return;
        }
        setError("Couldn’t look up that postcode. Please try again.");
        return;
      }

      const data = await res.json();
      if (data.status !== 200 || !data.result) {
        setError(FRIENDLY_BAD_POSTCODE);
        return;
      }

      const lat: number = Number(data.result.latitude);
      const lng: number = Number(data.result.longitude);
      const town: string =
        data.result.post_town ||
        data.result.admin_district ||
        data.result.parliamentary_constituency ||
        data.result.region ||
        "";

      // 2) Search via RPC (overloaded version with category slug)
      const { data: rows, error: rpcErr } = await supabase.rpc(
        "search_cleaners_by_location",
        {
          p_category_slug: serviceSlug,
          p_lat: lat,
          p_lng: lng,
          p_limit: 50,
        }
      );

      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }

      const list = (rows || []) as MatchIn[];

      // 3) Normalize
      const normalized: MatchOut[] = list.map((m) => ({
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
        distance_m: m.distance_meters ?? null,
        area_id: m.area_id ?? null,
        area_name: m.area_name ?? null,
        is_covering_sponsor: Boolean(m.is_covering_sponsor),
      }));

      // Optional “live only” filter (keeps your earlier intent)
      const liveOnly = normalized.filter((r) => {
        const hasPhone = Boolean(r.phone);
        const hasWhatsApp = Boolean(r.whatsapp);
        const hasWebsite = Boolean(r.website);
        return hasPhone || hasWhatsApp || hasWebsite;
      });

      // 4) Record impressions
      try {
        const sessionId = getOrCreateSessionId();
        const searchId = crypto.randomUUID();
        await Promise.all(
          liveOnly.map((r) =>
            r.area_id
              ? recordEvent({
                  cleanerId: r.cleaner_id,
                  areaId: r.area_id,
                  event: "impression",
                  sessionId,
                  meta: { search_id: searchId, postcode: pc, lat, lng, town },
                })
              : recordEventFromPointBeacon({
                  cleanerId: r.cleaner_id,
                  lat,
                  lng,
                  event: "impression",
                  sessionId,
                  meta: { search_id: searchId, postcode: pc, town },
                })
          )
        );
      } catch (e) {
        console.warn("recordEvent(impression) error", e);
      }

      // 5) Update UI / bubble up
      if (!onSearchComplete) setResults(liveOnly);
      onSearchComplete?.(liveOnly, pc, town, lat, lng);
    } catch (e: any) {
      console.error("FindCleaners lookup error:", e);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={lookup} className="flex gap-2">
        <input
          className="h-11 w-full rounded-xl border border-black/10 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
          placeholder="Enter postcode (e.g., BT20 5NF)"
          value={postcode}
          onChange={(e) => {
            setPostcode(e.target.value);
            if (error) setError(null); // clears the hint as soon as they edit
          }}
        />
        <button
          type="submit"
          className="h-11 shrink-0 rounded-xl bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <div className="mt-3 flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span className="text-lg leading-none">📍</span>
          <span className="whitespace-pre-line">
            {error}
          </span>
        </div>
      )}

      {/* Inline dev results list (only if you're not using onSearchComplete) */}
      {!onSearchComplete && results.length > 0 && (
        <div className="text-sm text-gray-600">
          Found {results.length} result{results.length === 1 ? "" : "s"}.
        </div>
      )}
    </div>
  );
}
