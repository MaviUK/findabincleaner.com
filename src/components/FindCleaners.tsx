// src/components/FindCleaners.tsx
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { recordEventFromPointBeacon, getOrCreateSessionId } from "../lib/analytics";

export type ServiceSlug = "bin-cleaner" | "window-cleaner" | "cleaner";

export type FindCleanersProps = {
  serviceSlug: ServiceSlug;

  /** ✅ lets the parent clear previous results immediately when a new search starts */
  onSearchStart?: () => void;

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

  /** ✅ add category_id so downstream components can log clicks correctly */
  category_id: string | null;
};

function toArray(v: unknown): string[] {
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

const FRIENDLY_BAD_POSTCODE =
  "Hmm… we couldn’t recognise that postcode.\nDouble-check it or try a nearby postcode.";

export default function FindCleaners({
  onSearchComplete,
  onSearchStart,
  serviceSlug,
}: FindCleanersProps) {
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MatchOut[]>([]);
  const [error, setError] = useState<string | null>(null);

  const submitCount = useRef(0);
  const lastImpressionKey = useRef<string>("");

  const categoryIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCategoryId() {
      try {
        const { data, error } = await supabase
          .from("service_categories")
          .select("id")
          .eq("slug", serviceSlug)
          .maybeSingle();

        if (!cancelled) {
          categoryIdRef.current = error ? null : data?.id ?? null;
        }
      } catch {
        if (!cancelled) categoryIdRef.current = null;
      }
    }

    categoryIdRef.current = null;
    void loadCategoryId();

    return () => {
      cancelled = true;
    };
  }, [serviceSlug]);

  async function ensureCategoryId(): Promise<string | null> {
    if (categoryIdRef.current) return categoryIdRef.current;

    try {
      const { data, error } = await supabase
        .from("service_categories")
        .select("id")
        .eq("slug", serviceSlug)
        .maybeSingle();

      const id = error ? null : data?.id ?? null;
      categoryIdRef.current = id;
      return id;
    } catch {
      return null;
    }
  }

  async function lookup(ev?: React.FormEvent) {
    ev?.preventDefault();
    setError(null);

    onSearchStart?.();
    if (!onSearchComplete) setResults([]);

    const pc = postcode.trim().toUpperCase().replace(/\s+/g, " ");
    if (!pc) {
      setError("Please enter a postcode.");
      return;
    }

    try {
      setLoading(true);
      submitCount.current += 1;

      // 1) Geocode postcode
      const res = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`
      );

      if (!res.ok) {
        onSearchStart?.();
        if (res.status === 404 || res.status === 400) {
          setError(FRIENDLY_BAD_POSTCODE);
          return;
        }
        setError("Couldn’t look up that postcode. Please try again.");
        return;
      }

      const data = await res.json();
      if (data.status !== 200 || !data.result) {
        onSearchStart?.();
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

      // ✅ ensure we have category id for logging + passing down
      const categoryId = await ensureCategoryId();

      // 2) Search via RPC (category slug overload)
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
        category_id: categoryId ?? null, // ✅ HERE
      }));

      // Optional “live only” filter
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
        const sponsoredCount = liveOnly.filter((x) => x.is_covering_sponsor).length;

        const impressionKey = `${pc}|${serviceSlug}|${lat.toFixed(5)}|${lng.toFixed(
          5
        )}|${liveOnly.length}`;

        if (lastImpressionKey.current !== impressionKey) {
          lastImpressionKey.current = impressionKey;

          await Promise.all(
            liveOnly.map((r, idx) =>
              recordEventFromPointBeacon({
                cleanerId: r.cleaner_id,
                lat,
                lng,
                event: "impression",
                sessionId,
                categoryId: categoryId ?? null, // ✅ ensures category_id writes
                meta: {
                  search_id: searchId,
                  postcode: pc,
                  town,
                  locality: town,
                  service_slug: serviceSlug,
                  area_id: r.area_id ?? null,
                  area_name: r.area_name ?? null,
                  position: idx + 1,
                  is_sponsored: Boolean(r.is_covering_sponsor),
                  results_count: liveOnly.length,
                  sponsored_count: sponsoredCount,
                },
              })
            )
          );
        }
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
          onChange={(e) => setPostcode(e.target.value)}
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
        <div className="mt-1 flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span className="text-lg leading-none">📍</span>
          <span className="whitespace-pre-line">{error}</span>
        </div>
      )}

      {!onSearchComplete && results.length > 0 && (
        <div className="text-sm text-gray-600">Found {results.length} cleaners.</div>
      )}
    </div>
  );
}
