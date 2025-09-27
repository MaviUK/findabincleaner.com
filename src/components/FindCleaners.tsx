// src/components/FindCleaners.tsx
import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type RpcMatch = { cleaner_id: string; business_name: string; distance_m?: number };

type CleanerCard = {
  id: string;
  business_name: string | null;
  logo_url: string | null;
  website: string | null;
  phone: string | null;
  distance_m?: number;
};

function formatDistance(m?: number) {
  if (typeof m !== "number") return "";
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

function toTelHref(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return `tel:${digits}`;
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

export default function FindCleaners() {
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CleanerCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const submitCount = useRef(0);

  async function lookup(ev?: React.FormEvent) {
    ev?.preventDefault();
    setError(null);
    setResults([]);

    const pc = postcode.trim().toUpperCase().replace(/\s+/g, " ");
    if (!pc) {
      setError("Please enter a postcode.");
      return;
    }

    try {
      setLoading(true);
      submitCount.current += 1;
      console.log(`[FindCleaners] submit #${submitCount.current}`, { pc });

      // 1) Geocode
      const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Postcode lookup failed: ${res.status}`);
      const data = await res.json();
      if (data.status !== 200 || !data.result) {
        setError("Postcode not found.");
        return;
      }
      const lat = Number(data.result.latitude);
      const lng = Number(data.result.longitude);
      console.log("[FindCleaners] geocode ok", { lat, lng });

      // 2) Covering / nearest cleaners
      const { data: matches, error: rpcError } = await supabase.rpc<
        RpcMatch[],
        { lat: number; lng: number }
      >("find_cleaners_for_point_sorted", { lat, lng });

      if (rpcError) {
        console.error("[FindCleaners] RPC error", rpcError);
        setError(rpcError.message);
        return;
      }
      const base = (matches || []) as RpcMatch[];
      if (base.length === 0) {
        setResults([]);
        return;
      }

      // 3) Enrich with logo, phone, website
      const ids = base.map((m) => m.cleaner_id);
      const { data: cleaners, error: qErr } = await supabase
        .from("cleaners")
        .select("id,business_name,logo_url,website,phone")
        .in("id", ids);

      if (qErr) {
        console.error("[FindCleaners] details query error", qErr);
        setResults(
          base.map((m) => ({
            id: m.cleaner_id,
            business_name: m.business_name,
            logo_url: null,
            website: null,
            phone: null,
            distance_m: m.distance_m,
          }))
        );
        return;
      }

      const byId = new Map((cleaners || []).map((c) => [c.id, c]));
      const enriched: CleanerCard[] = base.map((m) => {
        const c = byId.get(m.cleaner_id);
        return {
          id: m.cleaner_id,
          business_name: (c?.business_name ?? m.business_name) || m.business_name,
          logo_url: c?.logo_url ?? null,
          website: c?.website ?? null,
          phone: c?.phone ?? null,
          distance_m: m.distance_m,
        };
      });

      setResults(enriched);
    } catch (e: any) {
      console.error("[FindCleaners] catch", e);
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

      <ul className="space-y-2">
        {results.map((r) => {
          const tel = toTelHref(r.phone);
          const wa = toWhatsAppHref(r.phone);
          return (
            <li
              key={r.id}
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
                  <div className="font-medium truncate">{r.business_name}</div>
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
                {formatDistance(r.distance_m)}
              </div>
            </li>
          );
        })}
        {!loading && !error && results.length === 0 && (
          <li className="text-gray-500">No cleaners found yet.</li>
        )}
      </ul>
    </div>
  );
}
