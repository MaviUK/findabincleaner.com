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

/* =========================
   Types
========================= */

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

/* =========================
   Helpers
========================= */

const CATEGORY_OPTIONS = [
  { label: "All services", slug: "" },
  { label: "Bin Cleaner", slug: "bin-cleaner" },
  { label: "Window Cleaner", slug: "window-cleaner" },
  { label: "Cleaner", slug: "cleaner" },
];

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

/* =========================
   Component
========================= */

export default function FindCleaners({ onSearchComplete }: FindCleanersProps) {
  const [postcode, setPostcode] = useState("");
  const [categorySlug, setCategorySlug] = useState<string>("");
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

      /* 1) Geocode postcode */
      const res = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`
      );
      if (!res.ok) throw new Error("Postcode lookup failed");
      const data = await res.json();
      if (!data?.result) return setError("Postcode not found.");

      const lat = Number(data.result.latitude);
      const lng = Number(data.result.longitude);
      const town =
        data.result.post_town ||
        data.result.admin_district ||
        data.result.region ||
        "";

      setLocality(town);

      /* 2) Search cleaners (category-aware) */
      const { data: rows, error: rpcErr } = awaitsupabase.rpc("search_cleaners_by_location", {
  p_lat: lat,
  p_lng: lng,
  p_limit: 50,
  p_category_slug: serviceSlug,
});


      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }

      const list = (rows || []) as MatchIn[];

      /* 3) Normalize */
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
        area_id: m.area_id ?? null,
        area_name: m.area_name ?? null,
        is_covering_sponsor: Boolean(m.is_covering_sponsor),
      }));

      const liveOnly = normalized.filter(
        (r) => r.phone || r.whatsapp || r.website
      );

      /* 4) Analytics */
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
                    category: categorySlug || "all",
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
                    category: categorySlug || "all",
                  },
                })
          )
        );
      } catch {}

      if (!onSearchComplete) setResults(liveOnly);
      onSearchComplete?.(liveOnly, pc, town, lat, lng);
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  /* =========================
     UI
  ========================= */

  return (
    <div className="space-y-4">
      <form className="flex gap-2 flex-wrap" onSubmit={lookup}>
        <input
          className="border rounded px-3 py-2 flex-1"
          placeholder="Enter postcode (e.g., BT20 5NF)"
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
        />

        <select
          className="border rounded px-3 py-2"
          value={categorySlug}
          onChange={(e) => setCategorySlug(e.target.value)}
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>

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
          {results.map((r) => (
            <li
              key={r.cleaner_id}
              className="p-4 rounded-xl border flex justify-between"
            >
              <div>
                <div className="font-medium">
                  {r.business_name}
                  {r.is_covering_sponsor && (
                    <span className="ml-2 text-xs bg-emerald-100 px-2 py-0.5 rounded">
                      Sponsored
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-600">
                  {formatDistance(r.distance_m)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

