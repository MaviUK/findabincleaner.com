import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  recordEvent,
  recordEventBeacon,
  recordEventFromPointBeacon,
  getOrCreateSessionId,
} from "../lib/analytics";

export type FindCleanersProps = {
  onSearchComplete?: (results: MatchOut[], postcode: string, locality?: string) => void;
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

  // some installs already return this from the RPC; if not, we’ll fall back to point logging
  area_id?: string | null;
  area_name?: string | null;
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
    digits = `44${digits.slice(1)}`;
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

      // 1) geocode
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
      const town: string =
        data.result.post_town ||
        data.result.admin_district ||
        data.result.parliamentary_constituency ||
        data.result.region ||
        "";
      setLocality(town);

      // 2) polygon RPC first
      let list: MatchIn[] = [];
      {
        const { data: coverMatches, error: coverErr } = await supabase.rpc(
          "find_cleaners_covering_point",
          { lat, lng }
        );
        if (!coverErr && coverMatches) list = coverMatches as MatchIn[];
      }

      // 3) fallback to distance RPC
      if (!list.length) {
        const { data: distMatches, error: distErr } = await supabase.rpc(
          "find_cleaners_for_point_sorted",
          { lat, lng, max_km: 50, lim: 50 }
        );
        if (distErr && !list.length) {
          setError(distErr.message);
          return;
        }
        list = (distMatches || []) as MatchIn[];
      }

      // 4) normalize (note: we DO NOT fetch service_areas here anymore)
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
      }));

      // 5) record impressions (use area_id when present; otherwise point-based)
      try {
        const sessionId = getOrCreateSessionId();
        const searchId = crypto.randomUUID();
        await Promise.all(
          normalized.map((r) =>
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

      // put results in UI or bubble up
      if (!onSearchComplete) setResults(normalized);
      onSearchComplete?.(normalized, pc, town);

      // expose a click logger that falls back to point-based RPC
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
          {loading ? "Searching…" : "Find cleaners"}
        </button>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">
          {error}
        </div>
      )}

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
              No cleaners found near {postcode.trim().toUpperCase()}
              {locality ? `, in ${locality}` : ""}.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
