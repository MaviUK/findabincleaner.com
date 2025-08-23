import { useState } from "react";
import { supabase } from "../lib/supabase";

type Match = { cleaner_id: string; business_name: string; distance_m?: number };

export default function FindCleaners() {
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);

  const lookup = async () => {
    setError(null);
    setResults([]);
    const pc = postcode.trim();
    if (!pc) return setError("Please enter a postcode.");

    setLoading(true);
    try {
      // UK-only geocode
      const res = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`
      );
      const data = await res.json();
      if (data.status !== 200) {
        setError("Postcode not found.");
        return;
      }

      const lat = data.result.latitude as number;
      const lng = data.result.longitude as number;

      const { data: matches, error: rpcError } = await supabase.rpc(
        "find_cleaners_for_point_sorted",
        { lat, lng }
      );

      if (rpcError) {
        setError(rpcError.message);
        return;
      }

      setResults((matches || []) as Match[]);
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          className="border rounded px-3 py-2 w-full"
          placeholder="Enter postcode (e.g., BT20 5NF)"
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookup()}
        />
        <button
          className="bg-black text-white px-4 py-2 rounded"
          onClick={lookup}
          disabled={loading}
        >
          {loading ? "Searching…" : "Find Cleaners"}
        </button>
      </div>

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
