// src/pages/Analytics.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Row = {
  area_id: string;
  area_name: string | null;
  impressions: number | null;
  clicks_message: number | null;
  clicks_website: number | null;
  clicks_phone: number | null;
  cleaner_id: string;
};

export default function Analytics() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function loadRows() {
    try {
      setErr(null);
      setLoading(true);

      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error("You’re not signed in.");

      const { data: cleaner, error: ce } = await supabase
        .from("cleaners")
        .select("id")
        .eq("user_id", uid)
        .maybeSingle();
      if (ce) throw ce;
      if (!cleaner) throw new Error("No cleaner profile found.");

      const { data, error } = await supabase
        .from("area_stats_30d")
        .select("area_id, area_name, impressions, clicks_message, clicks_website, clicks_phone, cleaner_id")
        .eq("cleaner_id", cleaner.id)
        .order("area_name", { ascending: true });
      if (error) throw error;

      setRows((data as Row[]) || []);
      setLastUpdated(new Date());
    } catch (e: any) {
      console.error("Analytics load error:", e);
      setErr(e?.message || "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows();

    // quick auto-refresh so new events appear without manual reload
    const t1 = setTimeout(loadRows, 1500);
    const t2 = setTimeout(loadRows, 3500);

    const onFocus = () => loadRows();
    window.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => (r.area_name || "").toLowerCase().includes(term));
  }, [rows, q]);

  const totals = useMemo(() => {
    const init = { impressions: 0, msg: 0, web: 0, phone: 0 };
    return filtered.reduce((acc, r) => {
      acc.impressions += r.impressions || 0;
      acc.msg += r.clicks_message || 0;
      acc.web += r.clicks_website || 0;
      acc.phone += r.clicks_phone || 0;
      return acc;
    }, init);
  }, [filtered]);

  if (loading) {
    return (
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-6">
        Loading stats…
      </div>
    );
  }

  if (err) {
    return (
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-6">
        <div className="border rounded-xl p-4 text-red-700 bg-red-50">{err}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Stats by Area (Last 30 days)</h1>
          {lastUpdated && (
            <div className="text-xs text-gray-500 mt-1">
              Last updated {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by area name…"
            className="border rounded px-3 py-2 w-64"
          />
          <button
            type="button"
            onClick={loadRows}
            className="border rounded px-3 py-2 text-sm"
            title="Refresh"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border rounded-xl">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-gray-50">
              <th className="py-2 px-3">Area</th>
              <th className="py-2 px-3">Impressions</th>
              <th className="py-2 px-3">Clicks (Msg)</th>
              <th className="py-2 px-3">Clicks (Web)</th>
              <th className="py-2 px-3">Clicks (Phone)</th>
              <th className="py-2 px-3">Total Clicks</th>
              <th className="py-2 px-3">CTR</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const impressions = r.impressions || 0;
              const msg = r.clicks_message || 0;
              const web = r.clicks_website || 0;
              const phone = r.clicks_phone || 0;
              const total = msg + web + phone;
              const ctr = impressions ? `${((total / impressions) * 100).toFixed(1)}%` : "—";
              return (
                <tr key={r.area_id} className="border-b">
                  <td className="py-2 px-3">{r.area_name || r.area_id}</td>
                  <td className="py-2 px-3">{impressions}</td>
                  <td className="py-2 px-3">{msg}</td>
                  <td className="py-2 px-3">{web}</td>
                  <td className="py-2 px-3">{phone}</td>
                  <td className="py-2 px-3">{total}</td>
                  <td className="py-2 px-3">{ctr}</td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td className="py-6 px-3 text-gray-500" colSpan={7}>
                  {q.trim()
                    ? "No areas match your filter."
                    : "No stats yet. Try performing a search and clicking Message/Website/Phone on your listing."}
                </td>
              </tr>
            )}
          </tbody>

          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t bg-gray-50 font-medium">
                <td className="py-2 px-3">Total</td>
                <td className="py-2 px-3">{totals.impressions}</td>
                <td className="py-2 px-3">{totals.msg}</td>
                <td className="py-2 px-3">{totals.web}</td>
                <td className="py-2 px-3">{totals.phone}</td>
                <td className="py-2 px-3">{totals.msg + totals.web + totals.phone}</td>
                <td className="py-2 px-3">
                  {totals.impressions
                    ? `${(
                        ((totals.msg + totals.web + totals.phone) / totals.impressions) *
                        100
                      ).toFixed(1)}%`
                    : "—"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Impressions = your card was shown at least once per user search. Clicks are taps on Message, Website, or Phone.
      </p>
    </div>
  );
}
