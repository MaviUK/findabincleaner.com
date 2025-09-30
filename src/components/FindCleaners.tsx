// src/components/FindCleaners.tsx
import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { findContainingAreaId } from "../lib/areas";
import {
  recordEvent,
  recordEventBeacon,
  recordEventFromPointBeacon,
  getOrCreateSessionId,
} from "../lib/analytics";

export type FindCleanersProps = {
  // returns results + postcode + derived town/locality
  onSearchComplete?: (results: MatchOut[], postcode: string, locality?: string) => void;
};

// ---- RPC shapes (wide to be safe) ----
type MatchIn = {
  cleaner_id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  whatsapp?: string | null;
  payment_methods?: unknown;  // json/array/csv/string/null
  service_types?: unknown;    // json/array/csv/string/null
  rating_avg?: number | null;
  rating_count?: number | null;
  distance_m?: number | null;       // distance RPC returns this
  distance_meters?: number | null;  // alternate name, just in case

  // some implementations of find_cleaners_covering_point may already return these:
  area_id?: string | null;
  area_name?: string | null;
};

// ---- Outgoing shape used by UI (includes area_id) ----
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
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
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
  const [locality, setLocality] = useState<string>("");
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

      // 1) Geocode postcode -> lat/lng (+ town/locality)
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

      // Best-effort locality label for the UI
      const town: string =
        data.result.post_town ||
        data.result.admin_district ||
        data.result.parliamentary_constituency ||
        data.result.region ||
        "";
      setLocality(town);

      // 2) Try polygon-based RPC first (point-in-service-area)
      let list: MatchIn[] = [];
      {
        const { data: coverMatches, error: coverErr } = await supabase.rpc(
          "find_cleaners_covering_point",
          { lat, lng }
        );
        if (coverErr) {
          console.error("RPC find_cleaners_covering_point error:", coverErr);
        } else {
          list = (coverMatches || []) as MatchIn[];
        }
      }

      // 3) Fallback to distance-based RPC if polygon search found nothing
      if (!list.length) {
        const { data: distMatches, error: distErr } = await supabase.rpc(
          "find_cleaners_for_point_sorted",
          { lat, lng, max_km: 50, lim: 50 }
        );
        if (distErr) {
          console.error("RPC find_cleaners_for_point_sorted error:", distErr);
          if (!list.length) {
            setError(distErr.message);
            return;
          }
        } else {
          list = (distMatches || []) as MatchIn[];
        }
      }

      // 4) Normalize to MatchOut, keep any area_id returned by RPC
      const normalized = list.map<MatchOut>((m) => ({
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
        distance_m:
          (m.distance_meters as number | null | undefined) ??
          (m.distance_m ?? null),
        area_id: (m as any).area_id ?? null,
        area_name: (m as any).area_name ?? null,
      }));

      // 5) If some results lack area_id, fetch cleaner areas and compute via Turf
      const needArea = normalized.filter((n) => !n.area_id);
      let withArea = normalized;

      if (needArea.length) {
        const cleanerIds = [...new Set(needArea.map((m) => m.cleaner_id))];
        const { data: areasRows, error: areasErr } = await supabase
          .from("service_areas")
          .select("id, cleaner_id, geometry, name")
          .in("cleaner_id", cleanerIds);

        if (areasErr) {
          console.error("service_areas fetch error:", areasErr);
        } else {
          const areasByCleaner = new Map<
            string,
            { id: string; geometry: any; name?: string }[]
          >();
          (areasRows || []).forEach((r: any) => {
            const arr = areasByCleaner.get(r.cleaner_id) || [];
            const geom =
              typeof r.geometry === "string" ? JSON.parse(r.geometry) : r.geometry;
            arr.push({ id: r.id, geometry: geom, name: r.name });
            areasByCleaner.set(r.cleaner_id, arr);
          });

          withArea = normalized.map((m) => {
            if (m.area_id) return m;
            const arr = areasByCleaner.get(m.cleaner_id) || [];
            const areaId = findContainingAreaId(lat, lng, arr as any);
            return { ...m, area_id: areaId ?? null };
          });
        }
      }

      // 6) Record impressions for each returned result
      try {
        const sessionId = getOrCreateSessionId();
        const searchId = crypto.randomUUID();
        await Promise.all(
          withArea.map((r) => {
            if (r.area_id) {
              // direct record when we know the area
              return recordEvent({
                cleanerId: r.cleaner_id,
                areaId: r.area_id,
                event: "impression",
                sessionId,
                meta: { search_id: searchId, postcode: pc, lat, lng, town },
              });
            } else {
              // fall back to DB-side area resolution from the point
              return recordEventFromPointBeacon({
                cleanerId: r.cleaner_id,
                lat,
                lng,
                event: "impression",
                sessionId,
                meta: { search_id: searchId, postcode: pc, town },
              });
            }
          })
        );
      } catch (e) {
        // don't block UI if analytics fails
        console.warn("recordEvent(impression) error", e);
      }

      // 7) Push to parent or show inline
      if (!onSearchComplete) setResults(withArea);
      onSearchComplete?.(withArea, pc, town);
    } catch (e: any) {
      console.error("FindCleaners lookup error:", e);
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

      {/* Inline list only when parent didn't pass onSearchComplete */}
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
                          onClick={() =>
                            r.area_id
                              ? recordEventBeacon({
                                  cleanerId: r.cleaner_id,
                                  areaId: r.area_id,
                                  event: "click_website",
                                })
                              : recordEventFromPointBeacon({
                                  cleanerId: r.cleaner_id,
                                  // use the lat/lng from this search to resolve area on the server
                                  // (closure variables from lookup())
                                  // @ts-expect-error – lat/lng are in scope at runtime
                                  lat,
                                  // @ts-expect-error – lat/lng are in scope at runtime
                                  lng,
                                  event: "click_website",
                                })
                          }
                        >
                          Website
                        </a>
                      )}
                      {tel && (
                        <a
                          href={tel}
                          className="underline"
                          onClick={() =>
                            r.area_id
                              ? recordEventBeacon({
                                  cleanerId: r.cleaner_id,
                                  areaId: r.area_id,
                                  event: "click_phone",
                                })
                              : recordEventFromPointBeacon({
                                  cleanerId: r.cleaner_id,
                                  // @ts-expect-error – lat/lng are in scope at runtime
                                  lat,
                                  // @ts-expect-error – lat/lng are in scope at runtime
                                  lng,
                                  event: "click_phone",
                                })
                          }
                        >
                          Call
                        </a>
                      )}
                      {wa && (
                        <a
                          href={wa}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                          onClick={() =>
                            r.area_id
                              ? recordEventBeacon({
                                  cleanerId: r.cleaner_id,
                                  areaId: r.area_id,
                                  event: "click_message",
                                })
                              : recordEventFromPointBeacon({
                                  cleanerId: r.cleaner_id,
                                  // @ts-expect-error – lat/lng are in scope at runtime
                                  lat,
                                  // @ts-expect-error – lat/lng are in scope at runtime
                                  lng,
                                  event: "click_message",
                                })
                          }
                        >
                          WhatsApp
                        </a>
                      )}
                    </div>

                    {/* Optional: show which area matched (debug/QA) */}
                    {r.area_id && (
                      <div className="text-xs text-gray-500 mt-1">
                        Matched area: {r.area_id}
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-sm text-gray-700 whitespace-nowrap">
                  {formatDistance(r.distance_m)}
                </div>
              </li>
            );
          })}

          {!loading && !error && results.length === 0 && (
            <li className="text-gray-500">
              No cleaners found near {postcode.trim().toUpperCase()}
              {locality ? `, in ${locality}` : ""}.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
