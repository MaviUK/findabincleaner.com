// src/components/AnalyticsOverview.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Totals = {
  impressions: number;
  clicks_message: number;
  clicks_website: number;
  clicks_phone: number;
};

export default function AnalyticsOverview() {
  const [totals, setTotals] = useState<Totals>({
    impressions: 0,
    clicks_message: 0,
    clicks_website: 0,
    clicks_phone: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // find this user's cleaner id
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      if (!uid) {
        setTotals({ impressions: 0, clicks_message: 0, clicks_website: 0, clicks_phone: 0 });
        setLoading(false);
        return;
      }

      const { data: cleaner, error: ce } = await supabase
        .from("cleaners")
        .select("id")
        .eq("user_id", uid)
        .maybeSingle();

      if (ce || !cleaner) {
        setTotals({ impressions: 0, clicks_message: 0, clicks_website: 0, clicks_phone: 0 });
        setLoading(false);
        return;
      }

      // sum stats only for this cleaner
      const { data, error } = await supabase
        .from("area_stats_30d")
        .select("impressions, clicks_message, clicks_website, clicks_phone")
        .eq("cleaner_id", cleaner.id);

      if (error) {
        console.error("analytics overview error:", error);
        setTotals({ impressions: 0, clicks_message: 0, clicks_website: 0, clicks_phone: 0 });
        setLoading(false);
        return;
      }

      const agg = (data || []).reduce<Totals>(
        (acc, r: any) => ({
          impressions: acc.impressions + (r.impressions || 0),
          clicks_message: acc.clicks_message + (r.clicks_message || 0),
          clicks_website: acc.clicks_website + (r.clicks_website || 0),
          clicks_phone: acc.clicks_phone + (r.clicks_phone || 0),
        }),
        { impressions: 0, clicks_message: 0, clicks_website: 0, clicks_phone: 0 }
      );

      setTotals(agg);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-4 border rounded-xl">Loading analytics…</div>;

  const totalClicks = totals.clicks_message + totals.clicks_website + totals.clicks_phone;
  const ctr = totals.impressions ? `${((totalClicks / totals.impressions) * 100).toFixed(1)}%` : "—";

  return (
    <div className="p-4 border rounded-xl">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">Last 30 days</h3>
        <span className="text-sm text-gray-500">Across your service areas</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        <Stat label="Impressions" value={totals.impressions} />
        <Stat label="Clicks (Message)" value={totals.clicks_message} />
        <Stat label="Clicks (Website)" value={totals.clicks_website} />
        <Stat label="Clicks (Phone)" value={totals.clicks_phone} />
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
