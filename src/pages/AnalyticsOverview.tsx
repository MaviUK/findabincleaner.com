// src/components/AnalyticsOverview.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Row = {
  impressions: number;
  clicks_message: number;
  clicks_website: number;
  clicks_phone: number;
};

export default function AnalyticsOverview(props: {
  cleanerId: string;
  categoryId: string | null;
}) {
  const { cleanerId, categoryId } = props;

  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);

  const label = useMemo(() => (categoryId ? "This industry" : "All industries"), [categoryId]);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);

      let q = supabase
        .from("area_stats_30d")
        .select("impressions, clicks_message, clicks_website, clicks_phone")
        .eq("cleaner_id", cleanerId);

      // If your view includes category_id, filter it.
      // If it doesn't exist yet, the query will error — in that case you need to add category_id to the view.
      if (categoryId) q = q.eq("category_id", categoryId);

      const { data, error } = await q;

      if (!alive) return;

      if (error) {
        console.warn("AnalyticsOverview load error:", error);
        setRow({ impressions: 0, clicks_message: 0, clicks_website: 0, clicks_phone: 0 });
        setLoading(false);
        return;
      }

      const agg = (data || []).reduce(
        (acc: Row, r: any) => ({
          impressions: acc.impressions + (r.impressions || 0),
          clicks_message: acc.clicks_message + (r.clicks_message || 0),
          clicks_website: acc.clicks_website + (r.clicks_website || 0),
          clicks_phone: acc.clicks_phone + (r.clicks_phone || 0),
        }),
        { impressions: 0, clicks_message: 0, clicks_website: 0, clicks_phone: 0 }
      );

      setRow(agg);
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [cleanerId, categoryId]);

  if (loading) return <div className="p-4 border rounded-xl">Loading analytics…</div>;
  if (!row) return null;

  const totalClicks = row.clicks_message + row.clicks_website + row.clicks_phone;
  const ctr = row.impressions ? `${((totalClicks / row.impressions) * 100).toFixed(1)}%` : "—";

  return (
    <div className="p-4 border rounded-xl">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">Last 30 days</h3>
        <span className="text-sm text-gray-500">{label}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
  <Stat label="Impressions" value={totals.impressions} />
  <Stat label="Clicks (Message)" value={totals.clicks_message} />
  <Stat label="Clicks (Website)" value={totals.clicks_website} />
  <Stat label="Clicks (Phone)" value={totals.clicks_phone} />
  <Stat label="Total CTR" value={ctr} />
</div>

      <div className="mt-4 text-sm text-gray-700">
        <span className="font-medium">Total CTR:</span> {ctr}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="p-3 rounded-lg bg-gray-50 border">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-gray-600">{label}</div>
    </div>
  );
}
