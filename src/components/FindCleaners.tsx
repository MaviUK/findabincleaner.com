// src/components/FindCleaners.tsx
import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  recordEvent,
  recordEventBeacon,
  recordEventFromPointBeacon,
  getOrCreateSessionId,
} from "../lib/analytics";

export type FindCleanersProps = {
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
      if (Array.isArray(parsed)) return parsed;
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
  if (!phone.startsWith("+") && digits.startsWith("0")) {
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

      // 1) Geocode postcode
      const res = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`
      );
      if (!res.ok) throw new Error("Postcode lookup failed");
      const json = await res.json();
      if (!json.result) return setError("Postcode not found.");

      const lat = Number(json.result.latitude);
      const lng = Number(json.result.longitude);
      const town =
        json.result.post_town ||
        json.result.admin_district ||
        json.result.region ||
        "";

      setLocality(town);

      // 2) Sponsored-first RPC
      const { data, error: rpcErr } = await supabase.rpc(
        "search_cleaners_by_location",
        { p_lat: lat, p_lng: lng, p_limit: 50 }
      );

      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }

      const normalized: MatchOut[] = (data || []).map((m: MatchIn) => ({
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
          m.distance_meters ?? m.distance_m ?? null,
        area_id: m.area_id ?? null,
        area_name: m.area_name ?? null,
        is_covering_sponsor: Boolean(m.is_covering_sponsor),
      }));

      // 3) Analytics
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
      } catch {}

      if (!onSearchComplete) setResults(normalized);
      onSearchComplete?.(normalized, pc, town, lat, lng);
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const sponsored = results.filter((r) => r.is_covering_sponsor);
  const others = results.filter((r) => !r.is_covering_sponsor);

  return (
    <div className="space-y-4">
      <form className="flex gap-2" onSubmit={lookup}>
        <input
          className="border rounded px-3 py-2 w-full"
          placeholder="Enter postcode"
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
        <>
          {/* Sponsored – full width */}
          <div className="space-y-3">
            {sponsored.map((r) => (
              <CleanerCard key={r.cleaner_id} r={r} large />
            ))}
          </div>

          {/* Others – two column grid */}
          {others.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
              {others.map((r) => (
                <CleanerCard key={r.cleaner_id} r={r} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------- */
/* Cleaner Card Component */
/* ---------------------------- */

function CleanerCard({
  r,
  large = false,
}: {
  r: MatchOut;
  large?: boolean;
}) {
  const tel = toTelHref(r.phone);
  const wa = toWhatsAppHref(r.phone);

  return (
    <div
      className={`border rounded-xl p-4 flex justify-between gap-4 ${
        large ? "bg-emerald-50 border-emerald-300" : "bg-white"
      }`}
    >
      <div className="min-w-0">
        <div className="font-semibold truncate">
          {r.business_name ?? "Cleaner"}
          {large && (
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-emerald-600 text-white">
              Sponsored
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-3 text-sm text-gray-600 mt-1">
          {r.website && (
            <a href={r.website} target="_blank" rel="noreferrer" className="underline">
              Website
            </a>
          )}
          {tel && <a href={tel} className="underline">Call</a>}
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" className="underline">
              WhatsApp
            </a>
          )}
        </div>
      </div>

      <div className="text-sm text-gray-700 whitespace-nowrap">
        {formatDistance(r.distance_m)}
      </div>
    </div>
  );
}
