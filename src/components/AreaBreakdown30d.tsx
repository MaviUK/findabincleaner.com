import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Totals = {
  impressions: number;
  clicks_message: number;
  clicks_website: number;
  clicks_phone: number;
};

type AreaAgg = {
  area_id: string;
  area_name: string; // best-effort label
  impressions: number;
  clicks_message: number;
  clicks_website: number;
  clicks_phone: number;
};

type Props = {
  cleanerId: string;
  categoryId?: string | null;
};

const EVENTS = ["impression", "click_message", "click_website", "click_phone"] as const;
type EventName = (typeof EVENTS)[number];

export default function AreaBreakdown30d({ cleanerId, categoryId }: Props) {
  const [rows, setRows] = useState<AreaAgg[]>([]);
  const [overview, setOverview] = useState<Totals>({
    impressions: 0,
    clicks_message: 0,
    clicks_website: 0,
    clicks_phone: 0,
  });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Normalize category filter exactly like AnalyticsOverview
  const categoryFilter = (categoryId ?? "").trim() || null;

  // same "since" logic as AnalyticsOverview
  const sinceIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setErr(null);

        // 1) Get overall totals (same as AnalyticsOverview)
        async function countEvent(event: EventName) {
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

        const [impressions, clicks_message, clicks_website, clicks_phone] = await Promise.all([
          countEvent("impression"),
          countEvent("click_message"),
          countEvent("click_website"),
          countEvent("click_phone"),
        ]);

        const overviewTotals: Totals = {
          impressions,
          clicks_message,
          clicks_website,
          clicks_phone,
        };

        // 2) Fetch per-event rows with area_id so we can aggregate by area
        // NOTE: this fetches IDs only (very small rows), then aggregates in JS.
        // If volume ever gets huge, we can swap this for a SQL RPC for server-side group-by.
        let q2 = supabase
          .from("analytics_events")
          .select("area_id,event")
          .eq("cleaner_id", cleanerId)
          .gte("created_at", sinceIso)
          .in("event", EVENTS as unknown as string[])
          .not("area_id", "is", null);

        if (categoryFilter) q2 = q2.eq("category_id", categoryFilter);

        const { data: evRows, error: evErr } = await q2;
        if (evErr) throw evErr;

        // 3) Aggregate by area_id
        const byArea = new Map<string, AreaAgg>();
        for (const r of evRows || []) {
          const areaId = (r as any).area_id as string | null;
          const ev = (r as any).event as EventName;
          if (!areaId) continue;

          if (!byArea.has(areaId)) {
            byArea.set(areaId, {
              area_id: areaId,
              area_name: areaId, // placeholder until we load names
              impressions: 0,
              clicks_message: 0,
              clicks_website: 0,
              clicks_phone: 0,
            });
          }

          const agg = byArea.get(areaId)!;
          if (ev === "impression") agg.impressions += 1;
          if (ev === "click_message") agg.clicks_message += 1;
          if (ev === "click_website") agg.clicks_website += 1;
          if (ev === "click_phone") agg.clicks_phone += 1;
        }

        const areaIds = Array.from(byArea.keys());

        // 4) Best-effort: load readable area_name labels
        // We use area_stats_30d just as a lookup table for names you already display.
        // If this returns nothing, we still show the table with IDs.
        if (areaIds.length) {
          let qNames = supabase
            .from("area_stats_30d")
            .select("area_id, area_name")
            .eq("cleaner_id", cleanerId)
            .in("area_id", areaIds);

          // If your view supports category_id, keep it consistent
          if (categoryFilter) qNames = qNames.eq("category_id", categoryFilter);

          const { data: nameRows } = await qNames;
          const nameMap = new Map<string, string>();
          (nameRows || []).forEach((nr: any) => {
            if (nr?.area_id) nameMap.set(nr.area_id, nr.area_name || nr.area_id);
          });

          for (const [id, agg] of byArea) {
            const nm = nameMap.get(id);
            if (nm) agg.area_name = nm;
          }
        }

        // 5) Convert to array & sort
        const areaAggs = Array.from(byArea.values()).sort((a, b) =>
          (a.area_name || "").localeCompare(b.area_name || "")
        );

        // 6) Reconcile: compute "Unattributed / Outside areas"
        const areaSums = areaAggs.reduce(
          (acc, r) => {
            acc.impressions += r.impressions;
            acc.clicks_message += r.clicks_message;
            acc.clicks_website += r.clicks_website;
            acc.clicks_phone += r.clicks_phone;
            return acc;
          },
          { impressions: 0, clicks_message: 0, clicks_website: 0, clicks_phone: 0 }
        );

        const unattributed: AreaAgg = {
          area_id: "__unattributed__",
          area_name: "Unattributed / Outside areas",
          impressions: Math.max(0, overviewTotals.impressions - areaSums.impressions),
          clicks_message: Math.max(0, overviewTotals.clicks_message - areaSums.clicks_message),
          clicks_website: Math.max(0, overviewTotals.clicks_website - areaSums.clicks_website),
          clicks_phone: Math.max(0, overviewTotals.clicks_phone - areaSums.clicks_phone),
        };

        // Only show unattributed row if it has anything in it
        const hasUnattributed =
          unattributed.impressions +
            unattributed.clicks_message +
            unattributed.clicks_website +
            unattributed.clicks_phone >
          0;

        if (!alive) return;

        setOverview(overviewTotals);
        setRows(hasUnattributed ? [...areaAggs, unattributed] : areaAggs);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load area breakdown.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [cleanerId, categoryFilter, sinceIso]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.impressions += r.impressions || 0;
        acc.msg += r.clicks_message || 0;
        acc.web += r.clicks_website || 0;
        acc.phone += r.clicks_phone || 0;
        return acc;
      },
      { impressions: 0, msg: 0, web: 0, phone: 0 }
    );
  }, [rows]);

  if (loading) {
    return <div className="p-4 border rounded-xl">Loading area breakdown…</div>;
  }

  if (err) {
    return <div className="p-4 border rounded-xl bg-red-50 text-red-700">{err}</div>;
  }

  // This should now match the overview totals exactly (because we reconciled)
  const overviewClicks = overview.clicks_message + overview.clicks_website + overview.clicks_phone;
  const overviewCtr = overview.impressions
    ? `${((overviewClicks / overview.impressions) * 100).toFixed(1)}%`
    : "—";

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
        <div className="font-semibold">Stats by Area (Last 30 days)</div>
        <div className="text-xs text-gray-500">
          Totals reconcile with overview (CTR {overviewCtr})
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-white">
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
            {rows.map((r) => {
              const impressions = r.impressions || 0;
              const msg = r.clicks_message || 0;
              const web = r.clicks_website || 0;
              const phone = r.clicks_phone || 0;
              const total = msg + web + phone;
              const ctr = impressions ? `${((total / impressions) * 100).toFixed(1)}%` : "—";

              const isUnattributed = r.area_id === "__unattributed__";

              return (
                <tr key={r.area_id} className={isUnattributed ? "border-b bg-amber-50" : "border-b"}>
                  <td className="py-2 px-3">{r.area_name}</td>
                  <td className="py-2 px-3">{impressions}</td>
                  <td className="py-2 px-3">{msg}</td>
                  <td className="py-2 px-3">{web}</td>
                  <td className="py-2 px-3">{phone}</td>
                  <td className="py-2 px-3">{total}</td>
                  <td className="py-2 px-3">{ctr}</td>
                </tr>
              );
            })}

            {rows.length === 0 && (
              <tr>
                <td className="py-6 px-3 text-gray-500" colSpan={7}>
                  No area-attributed stats yet.
                </td>
              </tr>
            )}
          </tbody>

          {rows.length > 0 && (
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
                    ? `${(((totals.msg + totals.web + totals.phone) / totals.impressions) * 100).toFixed(1)}%`
                    : "—"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
