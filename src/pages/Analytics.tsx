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
};

export default function Analytics() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("area_stats_30d")
        .select("area_id, area_name, impressions, clicks_message, clicks_website, clicks_phone")
        .order("area_name", { ascending: true });

      if (!error && data) setRows(data as Row[]);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(r => (r.area_name || "").toLowerCase().includes(term));
  }, [rows, q]);

  if (loading) {
    return (
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-6">
        Loading stats…
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Stats by Area (Last 30 days)</h1>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by area name…"
          className="border rounded px-3 py-2 w-64"
        />
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
                  No areas match your filter.
                </td>
              </tr>
            )}
          </tbody>
        </ta
