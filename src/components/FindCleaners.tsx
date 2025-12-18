// src/components/FindCleaners.tsx
import { useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import {
  recordEvent,
  recordEventBeacon,
  recordEventFromPointBeacon,
  getOrCreateSessionId,
} from "../lib/analytics";

export type ServiceSlug = "bin-cleaner" | "window-cleaner" | "cleaner";

export type FindCleanersProps = {
  /**
   * REQUIRED: which category the user is searching for.
   * We use this to keep bin/window/cleaner results separate.
   */
  serviceSlug: ServiceSlug;

  /**
   * Includes lat/lng so parents (ResultsList → CleanerCard) can attribute clicks
   * even when a result doesn’t carry area_id.
   */
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
  distance_m?: number | null;
  distance_meters?: number | null;

  // Some installs return these directly from the RPC:
  area_id?: string | null;
  area_name?: string | null;

  // optional: if your RPC returns it, we just ignore it here unless you want to use it
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
    digits = `44${digits.slice(1)}`; // UK
  }
  return `https://wa.me/${digits}`;
}

export default function FindCleaners({
  serviceSlug,
  onSearchComplete,
}: FindCleanersProps) {
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MatchOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [locality, setLocality] = useState<string>("");

  const submitCount = useRef(0);

  async function lookup(ev?: FormEvent) {
    ev?.preventDefault();
    setError(null);
    if (!onSearchComplete) setResults([]);

    const pc = postcode.trim().toUpperCase().replace(/\s+/g, " ");
    if (!pc) return setError("Please enter a postcode.");

    try {
      setLoading(true);
      submitCount.current += 1;

      // 1) Geocode postcode -> lat/lng (postcodes.io)
      const res = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`
      );
      if (!res.ok) throw new Error(`Postcode lookup failed: ${res.status}`);
      const data = await res.json();
      if (data.status !== 200 || !data.result) {
        setError("Postcode not found.");
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

      setLocality(town);

      // 2) Category-aware search RPC
      // NOTE: your DB function MUST accept p_category_slug for this to work.
      // If it doesn't yet, you'll see a clean RPC error message.
      let list: MatchIn[] = [];
      {
        const { data: rows, error: rpcErr } = await supabase.rpc(
          "search_cleaners_by_location",
          {
            p_lat: lat,
            p_lng: lng,
            p_limit: 50,
            p_category_slug: serviceSlug, // <-- key change
          }
        );

        if (rpcErr) {
          setError(rpcErr.message);
          return;
        }

        list = (rows || []) as MatchIn[];
      }

      // 3) Normalize to UI type
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
        distance_m:
          (m.distance_meters as number | null | undefined) ??
          (m.distance_m ?? null),
        area_id: (m as any).area_id ?? null,
        area_name: (m as any).area_name ?? null,
        is_covering_sponsor: Boolean((m as any).is_covering_sponsor),
      }));

      // Keep only those with some contact method
      const liveOnly = normalized.filter(
        (r) => Boolean(r.website) || Boolean(r.phone) || Boolean(r.whatsapp)
      );

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
                  meta: {
                    search_id: searchId,
                    postcode: pc,
                    lat,
                    lng,
                    town,
                    category_slug: serviceSlug,
                  },
                })
              : recordEventFromPointBeacon({
                  cleanerId: r.cleaner_id,
                  lat,
                  lng,
                  event: "impression",
                  sessionId,
                  meta: {
                    search_id: searchId,
                    postcode: pc,
                    town,
                    category_slug: serviceSlug,
                  },
                })
          )
        );
      } catch (e) {
        console.warn("recordEvent(impression) error", e);
      }

      // 5) Update UI / bubble up — INCLUDING lat/lng
      if (!onSearchComplete) setResults(liveOnly);
      onSearchComplete?.(liveOnly, pc, town, lat, lng);

      // 6) Debug helper for inline list
      (window as any).__nbg_clickLogger = (
        r: MatchOut,
        ev: "click_website" | "click_phone" | "click_message"
      ) => {
        const sessionId = getOrCreateSessionId();
        return r.area_id
          ? recordEventBeacon({
              cleanerId: r.cleaner_id,
              areaId: r.area_id,
              event: ev,
              sessionId,
            })
          : recordEventFromPointBeacon({
              cleanerId: r.cleaner_id,
              lat,
              lng,
              event: ev,
              sessionId,
            });
      };
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
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">
          {error}
        </div>
      )}

      {/* Inline list (dev path only) */}
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
                      {r.is_covering_sponsor ? (
                        <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                          Sponsored
                        </span>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                      {r.website && (
                        <a
                          href={r.website}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                          onClick={(e) => {
                            e.preventDefault();
                            (window as any).__nbg_clickLogger?.(r, "click_website");
                            setTimeout(() => {
                              window.open(r.website!, "_blank", "noopener,noreferrer");
                            }, 10);
                          }}
                        >
                          Website
                        </a>
                      )}

                      {tel && (
                        <a
                          href={tel}
                          className="underline"
                          onClick={(e) => {
                            e.preventDefault();
                            (window as any).__nbg_clickLogger?.(r, "click_phone");
                            setTimeout(() => {
                              window.location.href = tel;
                            }, 10);
                          }}
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
                          onClick={(e) => {
                            e.preventDefault();
                            (window as any).__nbg_clickLogger?.(r, "click_message");
                            setTimeout(() => {
                              window.open(wa, "_blank", "noopener,noreferrer");
                            }, 10);
                          }}
                        >
                          WhatsApp
                        </a>
                      )}
                    </div>

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
              No results near {postcode.trim().toUpperCase()}
              {locality ? `, in ${locality}` : ""}.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
