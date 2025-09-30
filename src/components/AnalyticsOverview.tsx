// src/components/AnalyticsOverview.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Row = {
  impressions: number;
  clicks_message: number;
  clicks_website: number;
  clicks_phone: number;
};

export default function AnalyticsOverview() {
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Aggregate over your area_stats_30d view
      const { data, error } = await supabase
        .from("area_stats_30d")
        .select("impressions, clicks_message, clicks_website, clicks_phone");

      if (!error && data) {
        const agg = data.reduce(
          (acc: Row, r: any) => ({
            impressions: acc.impressions + (r.impressions || 0),
            clicks_message: acc.clicks_message + (r.clicks_message || 0),
            clicks_website: acc.clicks_website + (r.clicks_website || 0),
            clicks_phone: acc.clicks_phone + (r.clicks_phone || 0),
          }),
          { impressions: 0, clicks_message: 0, clicks_website: 0, clicks_phone: 0 }
        );
        setRow(agg);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-4 border rounded-xl">Loading analytics…</div>;
  if (!row) return null;

  const totalClicks = row.clicks_message + row.clicks_website + row.clicks_phone;
  const ctr = row.impressions ? `${((totalClicks / row.impressions) * 100).toFixed(1)}%` : "—";

  return (
    <div className="p-4 border rounded-xl">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">Last 30 days</h3>
        <span className="text-sm text-gray-500">Across all service areas</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        <Stat label="Impressions" value={row.impressions} />
        <Stat label="Clicks (Message)" value={row.clicks_message} />
        <Stat label="Clicks (Website)" value={row.clicks_website} />
        <Stat label="Clicks (Phone)" value={row.clicks_phone} />
      </div>
      <div className="mt-4 text-sm text-gray-700">
        <span className="font-medium">Total CTR:</span> {ctr}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-3 rounded-lg bg-gray-50 border">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-gray-600">{label}</div>
    </div>
  );
}
