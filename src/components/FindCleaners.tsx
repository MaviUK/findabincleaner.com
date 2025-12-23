// src/components/FindCleaners.tsx
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { getOrCreateSessionId, recordEventFetch } from "../lib/analytics";

export type ServiceSlug = "bin-cleaner" | "window-cleaner" | "cleaner";

export type FindCleanersProps = {
  serviceSlug: ServiceSlug;
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
  category_id?: string | null; // IMPORTANT: used by cards + analytics
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
  onSearchStart,
  serviceSlug,
}: FindCleanersProps) {
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MatchOut[]>([]);
  const [error, setError] = useState<string | null>(null);

  // stop duplicate impressions for the exact same search+result count
  const lastImpressionKey = useRef<string>("");

  // service_categories.id lookup (so analytics filters work)
  const categoryIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCategoryId() {
      const { data, error } = await supabase
        .from("service_categories")
        .select("id")
        .eq("slug", serviceSlug)
        .maybeSingle();

      if (!cancelled) categoryIdRef.current = error ? null : data?.id ?? null;
    }

    categoryIdRef.current = null;
    void loadCategoryId();

    return () => {
      cancelled = true;
    };
  }, [serviceSlug]);

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

      // 1) Geocode
      const res = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`
      );

      if (!res.ok) {
        if (res.status === 404 || res.status === 400) {
          setError(FRIENDLY_BAD_POSTCODE);
          return;
        }
        setError("Couldn’t look up that postcode. Please try again.");
        return;
      }

      const geo = await res.json();
      if (geo.status !== 200 || !geo.result) {
        setError(FRIENDLY_BAD_POSTCODE);
        return;
      }

      const lat: number = Number(geo.result.latitude);
      const lng: number = Number(geo.result.longitude);
      const town: string =
        geo.result.post_town ||
        geo.result.admin_district ||
        geo.result.parliamentary_constituency ||
        geo.result.region ||
        "";

      // 2) SAFE polygon-gated RPC (no area -> invisible; outside polygon -> invisible)
const { data: eligible, error: rpcErr } = await supabase.rpc("search_cleaners", {
  p_category_slug: serviceSlug,
  p_lat: lat,
  p_lng: lng,
});

if (rpcErr) {
  setError(rpcErr.message);
  return;
}

const eligibleIds = (eligible || [])
  .map((r: any) => r.cleaner_id)
  .filter(Boolean);


      if (eligibleIds.length === 0) {
        const none: MatchOut[] = [];
        if (!onSearchComplete) setResults(none);
        onSearchComplete?.(none, pc, town, lat, lng);
        return;
      }

      // 3) Fetch full cleaner details for the eligible IDs
      // NOTE: this keeps the UI working (phone/website/whatsapp/etc).
      // Area + sponsor flags will be wired back in once the RPC returns them safely.
      const { data: cleaners, error: cleanersErr } = await supabase
        .from("cleaners")
        .select(
          "id, business_name, logo_url, website, phone, whatsapp, payment_methods, service_types, rating_avg, rating_count"
        )
        .in("id", eligibleIds);

      if (cleanersErr) {
        setError(cleanersErr.message);
        return;
      }

      const categoryId = categoryIdRef.current;

      const normalized: MatchOut[] = (cleaners || []).map((c: any) => ({
        cleaner_id: c.id,
        business_name: c.business_name ?? null,
        logo_url: c.logo_url ?? null,
        website: c.website ?? null,
        phone: c.phone ?? null,
        whatsapp: c.whatsapp ?? null,
        payment_methods: toArray(c.payment_methods),
        service_types: toArray(c.service_types),
        rating_avg: c.rating_avg ?? null,
        rating_count: c.rating_count ?? null,
        distance_m: null,          // step-by-step: keep null for now
        area_id: null,             // step-by-step: re-add via RPC later
        area_name: null,           // step-by-step: re-add via RPC later
        is_covering_sponsor: false,// step-by-step: re-add via RPC later
        category_id: categoryId,
      }));

      // live-only
      const liveOnly = normalized.filter((r) => r.phone || r.whatsapp || r.website);

      // 4) Record impressions (FETCH so you SEE it in Network)
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
              recordEventFetch({
                event: "impression",
                cleanerId: r.cleaner_id,
                areaId: r.area_id ?? null,
                categoryId: r.category_id ?? null,
                sessionId,
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
                  lat,
                  lng,
                },
              })
            )
          );
        }
      } catch (e) {
        console.warn("impression logging failed", e);
      }

      // 5) Update UI
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


