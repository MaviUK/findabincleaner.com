// src/components/AnalyticsOverview.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import AreaBreakdown30d from "./AreaBreakdown30d";

type Totals = {
  impressions: number;
  clicks_message: number;
  clicks_website: number;
  clicks_phone: number;
};

type Props = {
  cleanerId: string;
  categoryId?: string | null;
};

export default function AnalyticsOverview({ cleanerId, categoryId }: Props) {
  const [totals, setTotals] = useState<Totals>({
    impressions: 0,
    clicks_message: 0,
    clicks_website: 0,
    clicks_phone: 0,
  });
  const [loading, setLoading] = useState(true);

  // Normalise categoryId: only filter if it's a real non-empty string
  const categoryFilter = (categoryId ?? "").trim() || null;

  // Stable "since" timestamp (last 30 days)
  const sinceIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);

      try {
        async function countEvent(event: string) {
          let q = supabase
            .from("analytics_events")
            .select("id", { count: "exact", head: true })
            .eq("cleaner_id", cleanerId)
            .eq("event", event)
            .gte("created_at", sinceIso);

          if (categoryFilter) q = q.eq("category_id", categoryFilter);

          const { count, error } = await q;
          if (error) throw error;
          return count ?? 0;
        }

        const [impressions, clicks_message, clicks_website, clicks_phone] =
          await Promise.all([
            countEvent("impression"),
            countEvent("click_message"),
            countEvent("click_website"),
            countEvent("click_phone"),
          ]);

        if (cancelled) return;

        setTotals({
          impressions,
          clicks_message,
          clicks_website,
          clicks_phone,
        });
      } catch (e) {
        console.error("AnalyticsOverview error:", e);
        if (!cancelled) {
          setTotals({
            impressions: 0,
            clicks_message: 0,
            clicks_website: 0,
            clicks_phone: 0,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cleanerId, categoryFilter, sinceIso]);

  if (loading) return <div className="p-4 border rounded-xl">Loading analytics…</div>;

  const totalClicks = totals.clicks_message + totals.clicks_website + totals.clicks_phone;
  const ctr = totals.impressions ? `${((totalClicks / totals.impressions) * 100).toFixed(1)}%` : "—";

  return (
    <div className="p-4 border rounded-xl">
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">Last 30 days</h3>
        <span className="text-sm text-gray-500">
          {categoryFilter ? "This industry" : "All industries"}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
  <Stat label="Impressions" value={totals.impressions} />
  <Stat label="Clicks (Message)" value={totals.clicks_message} />
  <Stat label="Clicks (Website)" value={totals.clicks_website} />
  <Stat label="Clicks (Phone)" value={totals.clicks_phone} />
  <Stat label="Total CTR" value={ctr} />
</div>


      {/* ✅ Collapsible breakdown */}
      <details className="mt-4 rounded-lg border bg-white">
        <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium flex items-center justify-between">
          <span>Stats by Area</span>
          <span className="text-xs text-gray-500">Click to expand</span>
        </summary>

        <div className="p-3 pt-0">
          <AreaBreakdown30d cleanerId={cleanerId} categoryId={categoryFilter} />
        </div>
      </details>
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
