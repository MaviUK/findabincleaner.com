// src/pages/Invoices.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type InvoiceRow = {
  id: string;
  cleaner_id: string;
  area_id: string | null;
  invoice_number: string | null;
  status: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  currency: string | null;
  created_at: string;
  billing_period_start: string | null;
  billing_period_end: string | null;
  pdf_url: string | null;
  pdf_signed_url: string | null;
};

type ServiceAreaRow = {
  id: string;
  category_id: string | null;
};

type CategoryRow = {
  id: string;
  name: string;
  slug?: string | null;
};

function formatMoney(cents: number | null | undefined, currency: string | null | undefined) {
  const c = Number(cents ?? 0);
  const cur = (currency || "GBP").toUpperCase();
  const amount = c / 100;

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
      currencyDisplay: "symbol",
    }).format(amount);
  } catch {
    // fallback
    const sym = cur === "GBP" ? "£" : "";
    return `${sym}${amount.toFixed(2)} ${cur}`.trim();
  }
}

function monthKey(iso: string) {
  // Returns YYYY-MM
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabel(yyyyMm: string) {
  // YYYY-MM -> "Dec 2025"
  const [y, m] = yyyyMm.split("-").map((x) => Number(x));
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return d.toLocaleString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

export default function Invoices() {
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [areas, setAreas] = useState<ServiceAreaRow[]>([]);
  const [industries, setIndustries] = useState<CategoryRow[]>([]);

  const [industryId, setIndustryId] = useState<string>("all"); // category id
  const [month, setMonth] = useState<string>("all"); // YYYY-MM

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErrMsg(null);

      try {
        // 1) get current user session
        const {
          data: { session },
          error: sesErr,
        } = await supabase.auth.getSession();
        if (sesErr) throw sesErr;
        const user = session?.user;
        if (!user) throw new Error("Not signed in.");

        // 2) get cleaner_id for this user
        const { data: cleaner, error: cleanerErr } = await supabase
          .from("cleaners")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cleanerErr) throw cleanerErr;
        if (!cleaner?.id) throw new Error("Cleaner record not found.");

        const cleanerId = cleaner.id;

        // 3) load invoices (ALL initially)
        const { data: invs, error: invErr } = await supabase
          .from("invoices")
          .select(
            "id,cleaner_id,area_id,invoice_number,status,subtotal_cents,tax_cents,total_cents,currency,created_at,billing_period_start,billing_period_end,pdf_url,pdf_signed_url"
          )
          .eq("cleaner_id", cleanerId)
          .order("created_at", { ascending: false });

        if (invErr) throw invErr;

        // 4) load service areas to map invoice.area_id -> category_id
        const { data: sas, error: saErr } = await supabase
          .from("service_areas")
          .select("id,category_id")
          .eq("cleaner_id", cleanerId);

        if (saErr) throw saErr;

        // 5) load industries for this cleaner via RPC (avoids querying missing tables/views)
        // Try common param names (change this if your RPC expects a different one)
        let cats: any[] | null = null;

        const try1 = await supabase.rpc("list_active_categories_for_cleaner", { p_cleaner_id: cleanerId });
        if (!try1.error) cats = Array.isArray(try1.data) ? try1.data : [];

        if (try1.error) {
          const try2 = await supabase.rpc("list_active_categories_for_cleaner", { cleaner_id: cleanerId });
          if (!try2.error) cats = Array.isArray(try2.data) ? try2.data : [];
          if (try2.error) {
            // don’t hard-fail the whole page; you can still show invoices without the industry dropdown
            console.warn("Could not load industries via RPC:", try1.error, try2.error);
            cats = [];
          }
        }

        const normCats: CategoryRow[] = (cats || [])
          .map((c: any) => ({
            id: String(c.id),
            name: String(c.name ?? c.category_name ?? c.slug ?? "Industry"),
            slug: c.slug ?? null,
          }))
          .filter((c) => c.id && c.name);

        if (!alive) return;

        setInvoices((invs || []) as InvoiceRow[]);
        setAreas((sas || []) as ServiceAreaRow[]);
        setIndustries(normCats);
      } catch (e: any) {
        console.error(e);
        if (!alive) return;
        setErrMsg(e?.message || "Failed to load invoices.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const areaToCategoryId = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const a of areas) m.set(a.id, a.category_id ?? null);
    return m;
  }, [areas]);

  const categoryById = useMemo(() => {
    const m = new Map<string, CategoryRow>();
    for (const c of industries) m.set(c.id, c);
    return m;
  }, [industries]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const inv of invoices) {
      if (inv.created_at) set.add(monthKey(inv.created_at));
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1)); // newest first
  }, [invoices]);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      // month filter
      if (month !== "all") {
        const mk = inv.created_at ? monthKey(inv.created_at) : "";
        if (mk !== month) return false;
      }

      // industry filter (based on service area category_id)
      if (industryId !== "all") {
        const catId = inv.area_id ? areaToCategoryId.get(inv.area_id) : null;
        if (!catId || String(catId) !== String(industryId)) return false;
      }

      return true;
    });
  }, [invoices, month, industryId, areaToCategoryId]);

  const clearFilters = () => {
    setIndustryId("all");
    setMonth("all");
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="section-title text-2xl mb-1">Invoices</h1>
          <p className="muted">Your invoice history ({filtered.length})</p>
        </div>

        <div className="flex gap-2">
          <Link to="/dashboard" className="btn">
            Back to dashboard
          </Link>
        </div>
      </div>

      {/* Filters */}
      <section className="card mt-6">
        <div className="card-pad">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
            <div>
              <label className="text-sm font-medium block mb-1">Sort by industry</label>
              <select
                className="input w-full"
                value={industryId}
                onChange={(e) => setIndustryId(e.target.value)}
                disabled={loading}
              >
                <option value="all">All industries</option>
                {industries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">Month issued</label>
              <select className="input w-full" value={month} onChange={(e) => setMonth(e.target.value)} disabled={loading}>
                <option value="all">All months</option>
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </div>

            <button className="btn" onClick={clearFilters} disabled={loading}>
              Clear
            </button>
          </div>
        </div>
      </section>

      {/* Error */}
      {errMsg && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
          {errMsg}
        </div>
      )}

      {/* Table */}
      <section className="card mt-6">
        <div className="card-pad">
          {loading ? (
            <div className="muted">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="muted">No invoices found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left">
                  <tr className="border-b border-ink-100">
                    <th className="py-2 pr-3">Invoice</th>
                    <th className="py-2 pr-3">Industry</th>
                    <th className="py-2 pr-3">Period</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Total</th>
                    <th className="py-2 pr-3">Created</th>
                    <th className="py-2 text-right">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((inv) => {
                    const catId = inv.area_id ? areaToCategoryId.get(inv.area_id) : null;
                    const industry = catId ? categoryById.get(String(catId))?.name : "—";

                    const period =
                      inv.billing_period_start && inv.billing_period_end
                        ? `${inv.billing_period_start} → ${inv.billing_period_end}`
                        : "—";

                    const created = inv.created_at
                      ? new Date(inv.created_at).toLocaleString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—";

                    const downloadUrl = inv.pdf_signed_url || inv.pdf_url || null;

                    return (
                      <tr key={inv.id} className="border-b border-ink-100 last:border-b-0">
                        <td className="py-3 pr-3 font-medium whitespace-nowrap">
                          {inv.invoice_number || "—"}
                        </td>
                        <td className="py-3 pr-3">{industry}</td>
                        <td className="py-3 pr-3 whitespace-nowrap">{period}</td>
                        <td className="py-3 pr-3 capitalize">{inv.status || "—"}</td>
                        <td className="py-3 pr-3 whitespace-nowrap">
                          {formatMoney(inv.total_cents, inv.currency)}
                        </td>
                        <td className="py-3 pr-3 whitespace-nowrap">{created}</td>
                        <td className="py-3 text-right">
                          {downloadUrl ? (
                            <a className="btn btn-sm" href={downloadUrl} target="_blank" rel="noreferrer">
                              PDF
                            </a>
                          ) : (
                            <span className="muted text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-3 text-xs muted">
                If “PDF” is blank, it means this invoice row doesn’t have a stored PDF link yet.
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
