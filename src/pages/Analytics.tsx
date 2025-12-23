// src/pages/Analytics.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Row30d = {
  area_id: string;
  area_name: string | null;
  impressions: number | null;
  clicks_message: number | null;
  clicks_website: number | null;
  clicks_phone: number | null;
  cleaner_id: string;
  category_id?: string | null;
};

type MonthRow = {
  month: string; // YYYY-MM
  impressions: number;
  clicks_message: number;
  clicks_website: number;
  clicks_phone: number;
  total_clicks: number;
  ctr: string; // "12.3%"
};

function useHashSearchParams() {
  const { hash } = useLocation();
  return useMemo(() => {
    const qIndex = hash.indexOf("?");
    const search = qIndex >= 0 ? hash.slice(qIndex) : "";
    return new URLSearchParams(search);
  }, [hash]);
}

function monthKey(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabel(ym: string) {
  // ym = YYYY-MM
  const [y, m] = ym.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return dt.toLocaleString(undefined, { month: "short", year: "numeric" });
}

export default function Analytics() {
  const [rows30d, setRows30d] = useState<Row30d[]>([]);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const qs = useHashSearchParams();
  const categoryId = (qs.get("category") ?? "").trim() || null;

  async function loadAll() {
    try {
      setErr(null);
      setLoading(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const uid = session?.user?.id;
      if (!uid) throw new Error("You’re not signed in.");

      // Find cleaner for this user
      const { data: cleaner, error: ce } = await supabase
        .from("cleaners")
        .select("id, created_at")
        .eq("user_id", uid)
        .maybeSingle();

      if (ce) throw ce;
      if (!cleaner) throw new Error("No cleaner profile found.");

      // ---------- 1) Last 30 days (existing) ----------
      let q30 = supabase
        .from("area_stats_30d")
        .select(
          "area_id, area_name, impressions, clicks_message, clicks_website, clicks_phone, cleaner_id, category_id"
        )
        .eq("cleaner_id", cleaner.id);

      if (categoryId) q30 = q30.eq("category_id", categoryId);

      const { data: d30, error: e30 } = await q30.order("area_name", {
        ascending: true,
      });

      if (e30) throw e30;
      setRows30d((d30 as Row30d[]) || []);

      // ---------- 2) Monthly breakdown since join ----------
      // We aggregate from analytics_events.
      // Only pull the columns we need to keep this light.
      let qe = supabase
        .from("analytics_events")
        .select("created_at, event")
        .eq("cleaner_id", cleaner.id);

      if (categoryId) qe = qe.eq("category_id", categoryId);

      // Pull from cleaner.created_at onwards (since they joined)
      if (cleaner.created_at) {
        qe = qe.gte("created_at", cleaner.created_at);
      }

      // NOTE: if you have huge event volume, we can move this to a SQL view later.
      const { data: evs, error: ee } = await qe.order("created_at", {
        ascending: true,
      });

      if (ee) throw ee;

      const bucket = new Map<
        string,
        { impressions: number; msg: number; web: number; phone: number }
      >();

      for (const e of evs || []) {
        const dt = new Date(e.created_at);
        const key = monthKey(dt);
        const cur = bucket.get(key) || { impressions: 0, msg: 0, web: 0, phone: 0 };

        if (e.event === "impression") cur.impressions += 1;
        if (e.event === "click_message") cur.msg += 1;
        if (e.event === "click_website") cur.web += 1;
        if (e.event === "click_phone") cur.phone += 1;

        bucket.set(key, cur);
      }

      const monthRows: MonthRow[] = Array.from(bucket.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([month, v]) => {
          const total = v.msg + v.web + v.phone;
          const ctr = v.impressions ? `${((total / v.impressions) * 100).toFixed(1)}%` : "—";
          return {
            month,
            impressions: v.impressions,
            clicks_message: v.msg,
            clicks_website: v.web,
            clicks_phone: v.phone,
            total_clicks: total,
            ctr,
          };
        });

      setMonths(monthRows);
      setLastUpdated(new Date());
    } catch (e: any) {
      console.error("Analytics load error:", e);
      setErr(e?.message || "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();

    const t1 = setTimeout(loadAll, 1500);
    const t2 = setTimeout(loadAll, 3500);

    const onFocus = () => loadAll();
    window.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const filtered30d = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows30d;
    return rows30d.filter((r) => (r.area_name || "").toLowerCase().includes(term));
  }, [rows30d, q]);

  const totals30d = useMemo(() => {
    const init = { impressions: 0, msg: 0, web: 0, phone: 0 };
    return filtered30d.reduce((acc, r) => {
      acc.impressions += r.impressions || 0;
      acc.msg += r.clicks_message || 0;
      acc.web += r.clicks_website || 0;
      acc.phone += r.clicks_phone || 0;
      return acc;
    }, init);
  }, [filtered30d]);

  const totalsMonths = useMemo(() => {
    const init = { impressions: 0, msg: 0, web: 0, phone: 0 };
    return months.reduce((acc, r) => {
      acc.impressions += r.impressions || 0;
      acc.msg += r.clicks_message || 0;
      acc.web += r.clicks_website || 0;
      acc.phone += r.clicks_phone || 0;
      return acc;
    }, init);
  }, [months]);

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
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Full Stats</h1>
          {lastUpdated && (
            <div className="text-xs text-gray-500 mt-1">
              Last updated {lastUpdated.toLocaleTimeString()}
            </div>
          )}
          {categoryId && (
            <div className="text-xs text-gray-500 mt-1">
              Filtered to industry: <span className="font-mono">{categoryId}</span>
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
            onClick={loadAll}
            className="border rounded px-3 py-2 text-sm"
            title="Refresh"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ---------- Monthly breakdown ---------- */}
      <div className="border rounded-2xl overflow-x-auto">
        <div className="px-4 py-3 border-b bg-gray-50">
          <div className="font-semibold">Monthly breakdown (since you joined)</div>
          <div className="text-xs text-gray-500">
            Impressions + Clicks grouped by month
          </div>
        </div>

        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-white">
              <th className="py-2 px-3">Month</th>
              <th className="py-2 px-3">Impressions</th>
              <th className="py-2 px-3">Clicks (Msg)</th>
              <th className="py-2 px-3">Clicks (Web)</th>
              <th className="py-2 px-3">Clicks (Phone)</th>
              <th className="py-2 px-3">Total Clicks</th>
              <th className="py-2 px-3">CTR</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-b">
                <td className="py-2 px-3">{monthLabel(m.month)}</td>
                <td className="py-2 px-3">{m.impressions}</td>
                <td className="py-2 px-3">{m.clicks_message}</td>
                <td className="py-2 px-3">{m.clicks_website}</td>
                <td className="py-2 px-3">{m.clicks_phone}</td>
                <td className="py-2 px-3">{m.total_clicks}</td>
                <td className="py-2 px-3">{m.ctr}</td>
              </tr>
            ))}

            {months.length === 0 && (
              <tr>
                <td className="py-6 px-3 text-gray-500" colSpan={7}>
                  No historical events yet.
                </td>
              </tr>
            )}
          </tbody>

          {months.length > 0 && (
            <tfoot>
              <tr className="border-t bg-gray-50 font-medium">
                <td className="py-2 px-3">Total</td>
                <td className="py-2 px-3">{totalsMonths.impressions}</td>
                <td className="py-2 px-3">{totalsMonths.msg}</td>
                <td className="py-2 px-3">{totalsMonths.web}</td>
                <td className="py-2 px-3">{totalsMonths.phone}</td>
                <td className="py-2 px-3">
                  {totalsMonths.msg + totalsMonths.web + totalsMonths.phone}
                </td>
                <td className="py-2 px-3">
                  {totalsMonths.impressions
                    ? `${(
                        ((totalsMonths.msg + totalsMonths.web + totalsMonths.phone) /
                          totalsMonths.impressions) *
                        100
                      ).toFixed(1)}%`
                    : "—"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ---------- Last 30 days by area ---------- */}
      <div className="border rounded-2xl overflow-x-auto">
        <div className="px-4 py-3 border-b bg-gray-50">
          <div className="font-semibold">Stats by Area (Last 30 days)</div>
          <div className="text-xs text-gray-500">
            This matches your dashboard “Last 30 days” cards.
          </div>
        </div>

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
            {filtered30d.map((r) => {
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

            {filtered30d.length === 0 && (
              <tr>
                <td className="py-6 px-3 text-gray-500" colSpan={7}>
                  {q.trim()
                    ? "No areas match your filter."
                    : "No 30-day stats yet for this filter."}
                </td>
              </tr>
            )}
          </tbody>

          {filtered30d.length > 0 && (
            <tfoot>
              <tr className="border-t bg-gray-50 font-medium">
                <td className="py-2 px-3">Total</td>
                <td className="py-2 px-3">{totals30d.impressions}</td>
                <td className="py-2 px-3">{totals30d.msg}</td>
                <td className="py-2 px-3">{totals30d.web}</td>
                <td className="py-2 px-3">{totals30d.phone}</td>
                <td className="py-2 px-3">{totals30d.msg + totals30d.web + totals30d.phone}</td>
                <td className="py-2 px-3">
                  {totals30d.impressions
                    ? `${(
                        ((totals30d.msg + totals30d.web + totals30d.phone) /
                          totals30d.impressions) *
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
        Monthly breakdown is built from raw analytics events. The “Last 30 days” table comes from{" "}
        <span className="font-mono">area_stats_30d</span>.
      </p>
    </div>
  );
}
