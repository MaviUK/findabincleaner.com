// src/pages/Invoices.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  status: string | null;
  total_cents: number | null;
  currency: string | null;
  billing_period_start: string | null; // YYYY-MM-DD
  billing_period_end: string | null;   // YYYY-MM-DD
  created_at: string;

  pdf_signed_url: string | null;
  pdf_url: string | null;

  // joined via FK: invoices.area_id -> service_areas.id
  service_areas?: {
    id: string;
    name: string | null;
    category_id: string | null;
    categories?: { id: string; name: string | null; slug: string | null } | null;
  } | null;
};

type GroupBy = "none" | "industry" | "month";

// helpers
function money(total_cents: number | null | undefined, currency: string | null | undefined) {
  if (total_cents == null) return "—";
  const val = (total_cents / 100).toFixed(2);
  return `${val} ${currency || "GBP"}`;
}

function monthKeyFromDateISO(iso: string) {
  // iso like "2025-12-30" or created_at full ISO
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}

function monthLabel(ym: string) {
  if (ym === "Unknown") return "Unknown month";
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

export default function Invoices() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<InvoiceRow[]>([]);

  // UI state
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [industryFilter, setIndustryFilter] = useState<string>("all"); // category_id or "all"
  const [monthFilter, setMonthFilter] = useState<string>("all"); // YYYY-MM or "all"

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          setError("Not signed in");
          setLoading(false);
          return;
        }

        // get cleaner_id
        const { data: cleaner, error: cleanerErr } = await supabase
          .from("cleaners")
          .select("id")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (cleanerErr || !cleaner) {
          setError("Cleaner record not found");
          setLoading(false);
          return;
        }

        // ✅ Fetch invoices and join to service_areas + categories (industry)
        // NOTE: This assumes you have:
        // - invoices.area_id FK -> service_areas.id
        // - service_areas.category_id FK -> categories.id
        const { data, error: invErr } = await supabase
          .from("invoices")
          .select(`
            id,
            invoice_number,
            status,
            total_cents,
            currency,
            billing_period_start,
            billing_period_end,
            created_at,
            pdf_signed_url,
            pdf_url,
            service_areas:service_areas!invoices_area_id_fkey (
              id,
              name,
              category_id,
              categories:categories ( id, name, slug )
            )
          `)
          .eq("cleaner_id", cleaner.id)
          .order("created_at", { ascending: false });

        if (invErr) {
          // If the FK name differs in your DB, Supabase will error here.
          // In that case, remove the join and we’ll do a second query approach.
          setError(invErr.message);
          setRows([]);
        } else {
          setRows((data as any) || []);
        }
      } catch (e: any) {
        setError(e?.message || "Failed to load invoices");
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Build industry dropdown options from fetched rows
  const industries = useMemo(() => {
    const map = new Map<string, string>(); // category_id -> name
    for (const r of rows) {
      const catId = r.service_areas?.category_id || "";
      const catName = r.service_areas?.categories?.name || "Unknown";
      if (catId) map.set(catId, catName);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [rows]);

  // Build month options from rows (use billing_period_start if present else created_at)
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const base = r.billing_period_start || r.created_at;
      set.add(monthKeyFromDateISO(base));
    }
    return Array.from(set)
      .filter(Boolean)
      .sort((a, b) => (a > b ? -1 : 1)); // newest first
  }, [rows]);

  // Apply filters
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const catId = r.service_areas?.category_id || null;
      if (industryFilter !== "all" && catId !== industryFilter) return false;

      if (monthFilter !== "all") {
        const base = r.billing_period_start || r.created_at;
        const mk = monthKeyFromDateISO(base);
        if (mk !== monthFilter) return false;
      }
      return true;
    });
  }, [rows, industryFilter, monthFilter]);

  // Grouping
  const grouped = useMemo(() => {
    if (groupBy === "none") {
      return [{ key: "All invoices", items: filtered }];
    }

    const map = new Map<string, InvoiceRow[]>();

    for (const r of filtered) {
      let key = "Unknown";

      if (groupBy === "industry") {
        key = r.service_areas?.categories?.name || "Unknown industry";
      } else if (groupBy === "month") {
        const base = r.billing_period_start || r.created_at;
        const mk = monthKeyFromDateISO(base);
        key = monthLabel(mk);
      }

      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }

    // sort groups sensibly
    const entries = Array.from(map.entries());
    if (groupBy === "month") {
      entries.sort((a, b) => {
        // monthLabel loses machine sorting; re-derive from first row in each group
        const aRow = a[1][0];
        const bRow = b[1][0];
        const aKey = monthKeyFromDateISO(aRow.billing_period_start || aRow.created_at);
        const bKey = monthKeyFromDateISO(bRow.billing_period_start || bRow.created_at);
        return aKey > bKey ? -1 : 1;
      });
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    }

    return entries.map(([key, items]) => ({ key, items }));
  }, [filtered, groupBy]);

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="section-title text-2xl">Invoices</h1>
        <Link to="/dashboard" className="btn">Back to dashboard</Link>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-pad flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
            <div>
              <label className="muted text-sm">Group by</label>
              <select
                className="input w-full"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              >
                <option value="none">None</option>
                <option value="industry">Industry</option>
                <option value="month">Month</option>
              </select>
            </div>

            <div>
              <label className="muted text-sm">Industry</label>
              <select
                className="input w-full"
                value={industryFilter}
                onChange={(e) => setIndustryFilter(e.target.value)}
              >
                <option value="all">All industries</option>
                {industries.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name || "Unknown"}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="muted text-sm">Month</label>
              <select
                className="input w-full"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
              >
                <option value="all">All months</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            className="btn sm:ml-3"
            onClick={() => {
              setGroupBy("none");
              setIndustryFilter("all");
              setMonthFilter("all");
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {loading && <div className="muted">Loading invoices…</div>}

      {error && <div className="alert alert-error mb-4">{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="muted">No invoices match those filters.</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-6">
          {grouped.map((g) => (
            <div key={g.key} className="card">
              <div className="card-pad flex items-center justify-between">
                <div className="font-semibold">{g.key}</div>
                <div className="muted text-sm">{g.items.length} invoice(s)</div>
              </div>

              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Industry</th>
                      <th>Status</th>
                      <th>Total</th>
                      <th>Created</th>
                      <th className="text-right">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((r) => {
                      const pdf = r.pdf_signed_url || r.pdf_url;
                      const industryName = r.service_areas?.categories?.name || "—";

                      return (
                        <tr key={r.id}>
                          <td>{r.invoice_number || "—"}</td>
                          <td>{industryName}</td>
                          <td className="capitalize">{r.status || "—"}</td>
                          <td>{money(r.total_cents, r.currency)}</td>
                          <td>{new Date(r.created_at).toLocaleDateString()}</td>
                          <td className="text-right">
                            {pdf ? (
                              <a
                                href={pdf}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-sm"
                              >
                                View
                              </a>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="card-pad border-t border-ink-100">
                <span className="muted text-sm">
                  Tip: Month uses billing_period_start if present, otherwise created_at.
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
