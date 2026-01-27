import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Row = {
  month: string; // YYYY-MM-01 from Postgres date
  impressions: number;
  clicks_message: number;
  clicks_website: number;
  clicks_phone: number;
};

export default function AreaHistoryModal({
  open,
  onClose,
  cleanerId,
  areaId,
  areaName,
  categoryId,
}: {
  open: boolean;
  onClose: () => void;
  cleanerId: string;
  areaId: string;
  areaName: string;
  categoryId?: string | null;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const categoryFilter = useMemo(() => (categoryId ?? "").trim() || null, [categoryId]);

  useEffect(() => {
    if (!open) return;

    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const { data, error } = await supabase.rpc("area_analytics_monthly", {
          p_cleaner_id: cleanerId,
          p_area_id: areaId,
          p_category_id: categoryFilter,
        });

        if (error) throw error;
        if (!alive) return;

        setRows((data || []).map((r: any) => ({
          month: r.month,
          impressions: Number(r.impressions || 0),
          clicks_message: Number(r.clicks_message || 0),
          clicks_website: Number(r.clicks_website || 0),
          clicks_phone: Number(r.clicks_phone || 0),
        })));
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Failed to load history.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open, cleanerId, areaId, categoryFilter]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const totals = rows.reduce(
    (acc, r) => {
      acc.impressions += r.impressions;
      acc.msg += r.clicks_message;
      acc.web += r.clicks_website;
      acc.phone += r.clicks_phone;
      return acc;
    },
    { impressions: 0, msg: 0, web: 0, phone: 0 }
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
          <div className="font-semibold">
            {areaName} — Monthly history (all time)
          </div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        <div className="p-4">
          {loading && <div className="text-sm text-gray-600">Loading…</div>}
          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{err}</div>}

          {!loading && !err && (
            <div className="overflow-x-auto border rounded-xl">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b bg-white">
                    <th className="py-2 px-3 text-left">Month</th>
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
                    const ctr = r.impressions ? `${((total / r.impressions) * 100).toFixed(1)}%` : "—";
                    const label = new Date(r.month).toLocaleDateString(undefined, { year: "numeric", month: "short" });

                    return (
                      <tr key={r.month} className="border-b">
                        <td className="py-2 px-3 text-left">{label}</td>
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
                    <td className="py-2 px-3 text-left">All-time total</td>
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
          )}
        </div>
      </div>
    </div>
  );
}
