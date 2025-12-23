// src/pages/Analytics.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Category = {
  id: string;
  name: string;
  slug: string;
};

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
  visits: number; // distinct meta.search_id
  impressions: number;
  clicks_message: number;
  clicks_website: number;
  clicks_phone: number;
  total_clicks: number;
  ctr: string;
};

function useHashSearchParams() {
  const { hash } = useLocation();
  return useMemo(() => {
    const qIndex = hash.indexOf("?");
    const search = qIndex >= 0 ? hash.slice(qIndex) : "";
    return new URLSearchParams(search);
  }, [hash]);
}

function setHashQueryParam(key: string, value: string | null) {
  const h = window.location.hash || "#/";
  const qIndex = h.indexOf("?");
  const base = qIndex >= 0 ? h.slice(0, qIndex) : h;
  const params = new URLSearchParams(qIndex >= 0 ? h.slice(qIndex) : "");
  if (value) params.set(key, value);
  else params.delete(key);
  const next = params.toString();
  window.location.hash = next ? `${base}?${next}` : base;
}

function monthKey(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return dt.toLocaleString(undefined, { month: "short", year: "numeric" });
}

export default function Analytics() {
  const qs = useHashSearchParams();
  const urlCategoryId = (qs.get("category") ?? "").trim() || null;

  const [cats, setCats] = useState<Category[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(urlCategoryId);

  const [rows30d, setRows30d] = useState<Row30d[]>([]);
  const [months, setMonths] = useState<MonthRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const activeCat = useMemo(() => {
    if (!activeCategoryId) return null;
    return cats.find((c) => c.id === activeCategoryId) || null;
  }, [cats, activeCategoryId]);

  async function loadIndustriesForCleaner(uid: string) {
    // Find cleaner
    const { data: cleaner, error: ce } = await supabase
      .from("cleaners")
      .select("id, created_at")
      .eq("user_id", uid)
      .maybeSingle();
    if (ce) throw ce;
    if (!cleaner) throw new Error("No cleaner profile found.");

    // 🔥 IMPORTANT: this is the only “unknown” bit because I can’t see your schema here.
    // We’ll try the most common patterns the dashboard uses:
    //
    // A) cleaner_categories table: (cleaner_id, category_id)
    // B) cleaner_services table: (cleaner_id, category_id)
    //
    // If your dashboard uses something else, tell me the table name + columns and I’ll adjust.

    // Try A) cleaner_categories
    const tryA = await supabase
      .from("cleaner_categories")
      .select("category_id, service_categories(id,name,slug)")
      .eq("cleaner_id", cleaner.id);

    if (!tryA.error && Array.isArray(tryA.data) && tryA.data.length > 0) {
      const mapped: Category[] = (tryA.data as any[])
        .map((r) => r.service_categories)
        .filter(Boolean);
      return { cleaner, categories: dedupeCats(mapped) };
    }

    // Try B) cleaner_services
    const tryB = await supabase
      .from("cleaner_services")
      .select("category_id, service_categories(id,name,slug)")
      .eq("cleaner_id", cleaner.id);

    if (!tryB.error && Array.isArray(tryB.data) && tryB.data.length > 0) {
      const mapped: Category[] = (tryB.data as any[])
        .map((r) => r.service_categories)
        .filter(Boolean);
      return { cleaner, categories: dedupeCats(mapped) };
    }

    // Fallback: show ALL categories (better than blank)
    const { data: sc, error: se } = await supabase
      .from("service_categories")
      .select("id,name,slug")
      .order("name", { ascending: true });
    if (se) throw se;

    return {
      cleaner,
      categories: dedupeCats(((sc as any[]) || []).map((x) => ({ id: x.id, name: x.name, slug: x.slug }))),
    };
  }

  function dedupeCats(list: Category[]) {
    const m = new Map<string, Category>();
    for (const c of list) {
      if (c?.id && !m.has(c.id)) m.set(c.id, c);
    }

    // Keep dashboard-like order if possible
    const preferred = ["bin-cleaner", "window-cleaner", "cleaner"];
    return Array.from(m.values()).sort((a, b) => {
      const ai = preferred.indexOf(a.slug);
      const bi = preferred.indexOf(b.slug);
      if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  async function loadStats(cleanerId: string, cleanerCreatedAt: string | null, categoryId: string) {
    // 1) 30d area stats
    const { data: d30, error: e30 } = await supabase
      .from("area_stats_30d")
      .select(
        "area_id, area_name, impressions, clicks_message, clicks_website, clicks_phone, cleaner_id, category_id"
      )
      .eq("cleaner_id", cleanerId)
      .eq("category_id", categoryId)
      .order("area_name", { ascending: true });

    if (e30) throw e30;
    setRows30d((d30 as Row30d[]) || []);

    // 2) Monthly breakdown since joined
    let qe = supabase
      .from("analytics_events")
      .select("created_at, event, meta")
      .eq("cleaner_id", cleanerId)
      .eq("category_id", categoryId);

    if (cleanerCreatedAt) qe = qe.gte("created_at", cleanerCreatedAt);

    const { data: evs, error: ee } = await qe.order("created_at", { ascending: true });
    if (ee) throw ee;

    const bucket = new Map<
      string,
      { impressions: number; msg: number; web: number; phone: number; searchIds: Set<string> }
    >();

    for (const e of (evs as any[]) || []) {
      const key = monthKey(new Date(e.created_at));
      const cur =
        bucket.get(key) || { impressions: 0, msg: 0, web: 0, phone: 0, searchIds: new Set<string>() };

      if (e.event === "impression") {
        cur.impressions += 1;
        const sid = e?.meta?.search_id;
        if (typeof sid === "string" && sid.length > 0) cur.searchIds.add(sid);
      }
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
          visits: v.searchIds.size,
          impressions: v.impressions,
          clicks_message: v.msg,
          clicks_website: v.web,
          clicks_phone: v.phone,
          total_clicks: total,
          ctr,
        };
      });

    setMonths(monthRows);
  }

  async function loadAll() {
    try {
      setErr(null);
      setLoading(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const uid = session?.user?.id;
      if (!uid) throw new Error("You’re not signed in.");

      const { cleaner, categories } = await loadIndustriesForCleaner(uid);

      setCats(categories);

      // pick active tab:
      // - if URL has category and it is in categories, use it
      // - else default to first category
      const validUrlCat =
        urlCategoryId && categories.some((c) => c.id === urlCategoryId) ? urlCategoryId : null;

      const nextActive = validUrlCat || categories[0]?.id || null;

      if (nextActive && nextActive !== activeCategoryId) {
        setActiveCategoryId(nextActive);
        setHashQueryParam("category", nextActive);
        // we’ll continue; no harm
      }

      if (!nextActive) {
        setRows30d([]);
        setMonths([]);
        setLastUpdated(new Date());
        return;
      }

      await loadStats(cleaner.id, cleaner.created_at ?? null, nextActive);
      setLastUpdated(new Date());
    } catch (e: any) {
      console.error("Analytics load error:", e);
      setErr(e?.message || "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }

  // if hash category changes, switch tabs
  useEffect(() => {
    if (!urlCategoryId) return;
    if (urlCategoryId !== activeCategoryId) {
      setActiveCategoryId(urlCategoryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCategoryId]);

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
  }, [activeCategoryId]);

  const filtered30d = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows30d;
    return rows30d.filter((r) => (r.area_name || "").toLowerCase().includes(term));
  }, [rows30d, q]);

  if (loading) {
    return <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-6">Loading stats…</div>;
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
          {activeCat && (
            <div className="text-sm text-gray-600 mt-1">
              Industry: <span className="font-semibold">{activeCat.name}</span>
            </div>
          )}
          {lastUpdated && (
            <div className="text-xs text-gray-500 mt-1">
              Last updated {lastUpdated.toLocaleTimeString()}
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
          <button type="button" onClick={loadAll} className="border rounded px-3 py-2 text-sm">
            Refresh
          </button>
        </div>
      </div>

      {/* ✅ Industry tabs (business-active industries) */}
      {cats.length > 0 && (
        <div className="inline-flex flex-wrap gap-2">
          {cats.map((c) => {
            const active = c.id === activeCategoryId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setActiveCategoryId(c.id);
                  setHashQueryParam("category", c.id);
                }}
                className={[
                  "px-4 py-2 rounded-xl border text-sm font-semibold transition",
                  "focus:outline-none focus:ring-2 focus:ring-emerald-500/40",
                  active
                    ? "bg-emerald-700 text-white border-emerald-700 shadow-sm"
                    : "bg-white text-gray-900 border-gray-200 hover:border-gray-300",
                ].join(" ")}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Monthly breakdown */}
      <div className="border rounded-2xl overflow-x-auto">
        <div className="px-4 py-3 border-b bg-gray-50">
          <div className="font-semibold">Monthly breakdown (since you joined)</div>
          <div className="text-xs text-gray-500">
            Visits = 1 unique search where your card appeared (distinct <span className="font-mono">meta.search_id</span>)
          </div>
        </div>

        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left border-b bg-white">
              <th className="py-2 px-3">Month</th>
              <th className="py-2 px-3">Visits</th>
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
                <td className="py-2 px-3">{m.visits}</td>
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
                <td className="py-6 px-3 text-gray-500" colSpan={8}>
                  No history yet for this industry.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Last 30 days by area */}
      <div className="border rounded-2xl overflow-x-auto">
        <div className="px-4 py-3 border-b bg-gray-50">
          <div className="font-semibold">Stats by Area (Last 30 days)</div>
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
                  {q.trim() ? "No areas match your filter." : "No 30-day stats yet for this industry."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Tabs show only industries your business is active in (same concept as the dashboard).
      </p>
    </div>
  );
}
