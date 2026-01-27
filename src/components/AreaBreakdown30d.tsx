import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import AreaHistoryModal from "./AreaHistoryModal";

type Totals = {
  impressions: number;
  clicks_message: number;
  clicks_website: number;
  clicks_phone: number;
};

type AreaAgg = {
  area_id: string;
  area_name: string;
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

  // history modal state
  const [histOpen, setHistOpen] = useState(false);
  const [histAreaId, setHistAreaId] = useState<string | null>(null);
  const [histAreaName, setHistAreaName] = useState<string>("");

  const categoryFilter = (categoryId ?? "").trim() || null;
  console.log("[AreaBreakdown30d]", { cleanerId, categoryId, categoryFilter });


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

        /* ---------------------------------------------------------
         * 1) Load ALL service areas for this cleaner (filtered by category)
         * ------------------------------------------------------- */
        let areasQ = supabase
          .from("service_areas")
          .select("id, name")
          .eq("cleaner_id", cleanerId);

        if (categoryFilter) areasQ = areasQ.eq("category_id", categoryFilter);

        const { data: areas, error: areasErr } = await areasQ;
        if (areasErr) throw areasErr;

        const areaMap = new Map<string, AreaAgg>();
        (areas || []).forEach((a: any) => {
          areaMap.set(a.id, {
            area_id: a.id,
            area_name: a.name,
            impressions: 0,
            clicks_message: 0,
            clicks_website: 0,
            clicks_phone: 0,
          });
        });

        /* ---------------------------------------------------------
         * 2) Load overview totals (for this category)
         * ------------------------------------------------------- */
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

        const [impressions, clicks_message, clicks_website, clicks_phone] =
          await Promise.all([
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

        /* ---------------------------------------------------------
         * 3) Pull all area-attributed events and aggregate (for this category)
         * ------------------------------------------------------- */
        let evQ = supabase
          .from("analytics_events")
          .select("area_id,event")
          .eq("cleaner_id", cleanerId)
          .gte("created_at", sinceIso)
          .in("event", EVENTS as unknown as string[])
          .not("area_id", "is", null);

        if (categoryFilter) evQ = evQ.eq("category_id", categoryFilter);

        const { data: evRows, error: evErr } = await evQ;
        if (evErr) throw evErr;

        for (const r of evRows || []) {
          const areaId = (r as any).area_id as string;
          const ev = (r as any).event as EventName;
          const agg = areaMap.get(areaId);
          if (!agg) continue;

          if (ev === "impression") agg.impressions++;
          if (ev === "click_message") agg.clicks_message++;
          if (ev === "click_website") agg.clicks_website++;
          if (ev === "click_phone") agg.clicks_phone++;
        }

        /* ---------------------------------------------------------
         * 4) Compute "Unattributed / Outside areas" DIRECTLY (area_id IS NULL)
         *    ✅ avoids fake unattributed caused by category mismatches
         * ------------------------------------------------------- */
        async function countUnattributed(event: EventName) {
          let q = supabase
            .from("analytics_events")
            .select("id", { count: "exact", head: true })
            .eq("cleaner_id", cleanerId)
            .eq("event", event)
            .gte("created_at", sinceIso)
            .is("area_id", null);

          if (categoryFilter) q = q.eq("category_id", categoryFilter);

          const { count, error } = await q;
          if (error) throw error;
          return count ?? 0;
        }

        const [uImp, uMsg, uWeb, uPhone] = await Promise.all([
          countUnattributed("impression"),
          countUnattributed("click_message"),
          countUnattributed("click_website"),
          countUnattributed("click_phone"),
        ]);

        const unattributed: AreaAgg = {
          area_id: "__unattributed__",
          area_name: "Unattributed / Outside areas",
          impressions: uImp,
          clicks_message: uMsg,
          clicks_website: uWeb,
          clicks_phone: uPhone,
        };

        const hasUnattributed =
          unattributed.impressions +
            unattributed.clicks_message +
            unattributed.clicks_website +
            unattributed.clicks_phone >
          0;

        const finalRows = Array.from(areaMap.values()).sort((a, b) =>
          a.area_name.localeCompare(b.area_name)
        );

        if (hasUnattributed) finalRows.push(unattributed);

        if (!alive) return;

        setOverview(overviewTotals);
        setRows(finalRows);
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
        acc.impressions += r.impressions;
        acc.msg += r.clicks_message;
        acc.web += r.clicks_website;
        acc.phone += r.clicks_phone;
        return acc;
      },
      { impressions: 0, msg: 0, web: 0, phone: 0 }
    );
  }, [rows]);

  if (loading) return <div className="p-4 border rounded-xl">Loading area breakdown…</div>;
  if (err)
    return <div className="p-4 border rounded-xl bg-red-50 text-red-700">{err}</div>;

  return (
    <>
      <div className="border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50 font-semibold">
          Stats by Area (Last 30 days)
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-white">
                <th className="py-2 px-3 text-left">Area</th>
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
                const total = r.clicks_message + r.clicks_website + r.clicks_phone;
                const ctr = r.impressions
                  ? `${((total / r.impressions) * 100).toFixed(1)}%`
                  : "—";

                const isUnattributed = r.area_id === "__unattributed__";

                return (
                  <tr
                    key={r.area_id}
                    className={isUnattributed ? "bg-amber-50 border-b" : "border-b"}
                  >
                    <td className="py-2 px-3">
                      {isUnattributed ? (
                        r.area_name
                      ) : (
                        <button
                          type="button"
                          className="underline underline-offset-2 hover:opacity-80 text-left"
                          title="View month-by-month history"
                          onClick={() => {
                            setHistAreaId(r.area_id);
                            setHistAreaName(r.area_name);
                            setHistOpen(true);
                          }}
                        >
                          {r.area_name}
                        </button>
                      )}
                    </td>
                    <td className="py-2 px-3">{r.impressions}</td>
                    <td className="py-2 px-3">{r.clicks_message}</td>
                    <td className="py-2 px-3">{r.clicks_website}</td>
                    <td className="py-2 px-3">{r.clicks_phone}</td>
                    <td className="py-2 px-3">{total}</td>
                    <td className="py-2 px-3">{ctr}</td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr className="bg-gray-50 border-t font-medium">
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
          </table>
        </div>
      </div>

      {histAreaId && (
        <AreaHistoryModal
          open={histOpen}
          onClose={() => setHistOpen(false)}
          cleanerId={cleanerId}
          areaId={histAreaId}
          areaName={histAreaName}
          categoryId={categoryFilter}
        />
      )}
    </>
  );
}
