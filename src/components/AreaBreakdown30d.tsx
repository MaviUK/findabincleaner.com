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
  category_id?: string | null;
};

export default function AreaBreakdown30d({
  cleanerId,
  categoryId,
}: {
  cleanerId: string;
  categoryId: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setErr(null);

        // If your DB view/table DOES NOT have category_id,
        // remove the .eq("category_id", categoryId) line.
        const q = supabase
          .from("area_stats_30d")
          .select(
            "area_id, area_name, impressions, clicks_message, clicks_website, clicks_phone, cleaner_id, category_id"
          )
          .eq("cleaner_id", cleanerId);

        const { data, error } =
          categoryId ? await q.eq("category_id", categoryId) : await q;

        if (error) throw error;
        if (!alive) return;

        const sorted = ((data as Row[]) || []).sort((a, b) =>
          (a.area_name || "").localeCompare(b.area_name || "")
        );

        setRows(sorted);
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
  }, [cleanerId, categoryId]);

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

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
        <div className="font-semibold">Stats by Area (Last 30 days)</div>
        <div className="text-xs text-gray-500">Your covered areas</div>
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

            {rows.length === 0 && (
              <tr>
                <td className="py-6 px-3 text-gray-500" colSpan={7}>
                  No stats yet for your service areas.
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
