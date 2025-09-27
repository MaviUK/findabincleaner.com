// src/components/FindCleaners.tsx
import { useState, useRef } from "react";
import { supabase } from "../lib/supabase";

type Match = { cleaner_id: string; business_name: string; distance_m?: number };

export default function FindCleaners() {
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);
  const submittedRef = useRef(0);

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
      submittedRef.current += 1;
      console.log(`[FindCleaners] submit #${submittedRef.current}`, { pc });

      // 1) Geocode
      const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`;
      console.log("[FindCleaners] fetching", url);
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

      // 2) RPC
      const { data: matches, error: rpcError } = await supabase.rpc(
        "find_cleaners_for_point_sorted",
        { lat, lng }
      );
      if (rpcError) {
        console.error("[FindCleaners] RPC error", rpcError);
        setError(rpcError.message);
        return;
      }

      console.log("[FindCleaners] RPC ok", matches);
      setResults((matches || []) as Match[]);
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
        {results.map((r) => (
          <li
            key={r.cleaner_id}
            className="p-4 rounded-xl border flex items-center justify-between"
          >
            <span>{r.business_name}</span>
            {typeof r.distance_m === "number" && (
              <span>{Math.round(r.distance_m)} m</span>
            )}
          </li>
        ))}
        {!loading && !error && results.length === 0 && (
          <li className="text-gray-500">No cleaners found yet.</li>
        )}
      </ul>
    </div>
  );
}
