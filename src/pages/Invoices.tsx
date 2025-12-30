// src/pages/Invoices.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type InvoiceRow = {
  id: string;
  cleaner_id: string;
  area_id: string | null;

  stripe_invoice_id: string | null;
  invoice_number: string | null;
  status: string | null;

  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  currency: string | null;

  billing_period_start: string | null; // YYYY-MM-DD
  billing_period_end: string | null; // YYYY-MM-DD
  created_at: string;

  pdf_signed_url: string | null;
  pdf_url: string | null;
};

type ServiceAreaRow = {
  id: string;
  name: string | null;
  category_id: string | null;
};

type CategoryRow = {
  id: string;
  name: string | null;
  slug: string | null;
};

function money(total_cents: number | null | undefined, currency: string | null | undefined) {
  if (total_cents == null) return "—";
  const v = (total_cents / 100).toFixed(2);
  return `${v} ${currency || "GBP"}`;
}

function monthKeyFromISO(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // YYYY-MM
}

function monthLabel(ym: string) {
  if (ym === "Unknown") return "Unknown";
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

export default function Invoices() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [areaById, setAreaById] = useState<Record<string, ServiceAreaRow>>({});
  const [catById, setCatById] = useState<Record<string, CategoryRow>>({});

  // Dropdowns
  const [industryId, setIndustryId] = useState<string>("all"); // "all" or category_id
  const [month, setMonth] = useState<string>("all"); // "all" or YYYY-MM

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: sessionRes } = await supabase.auth.getSession();
        const session = sessionRes?.session;
        if (!session?.user) {
          setError("Not signed in");
          setLoading(false);
          return;
        }

        // Cleaner id
        const { data: cleaner, error: cleanerErr } = await supabase
          .from("cleaners")
          .select("id")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (cleanerErr) throw cleanerErr;
        if (!cleaner?.id) {
          setError("Cleaner record not found.");
          setLoading(false);
          return;
        }

        // 1) Load ALL invoices for this cleaner
        const { data: inv, error: invErr } = await supabase
          .from("invoices")
          .select(
            "id,cleaner_id,area_id,stripe_invoice_id,invoice_number,status,subtotal_cents,tax_cents,total_cents,currency,billing_period_start,billing_period_end,created_at,pdf_signed_url,pdf_url"
          )
          .eq("cleaner_id", cleaner.id)
          .order("created_at", { ascending: false });

        if (invErr) throw invErr;

        const invRows = (inv as InvoiceRow[]) || [];
        setInvoices(invRows);

        // 2) Load service_areas for any area_id present (to find category_id)
        const areaIds = Array.from(
          new Set(invRows.map((r) => r.area_id).filter(Boolean) as string[])
        );

        let areasMap: Record<string, ServiceAreaRow> = {};
        if (areaIds.length) {
          const { data: areas, error: areaErr } = await supabase
            .from("service_areas")
            .select("id,name,category_id")
            .in("id", areaIds);

          if (areaErr) throw areaErr;

          for (const a of (areas as ServiceAreaRow[]) || []) {
            areasMap[a.id] = a;
          }
        }
        setAreaById(areasMap);

        // 3) Load categories by id (NO relationship required)
        const catIds = Array.from(
          new Set(Object.values(areasMap).map((a) => a.category_id).filter(Boolean) as string[])
        );

        let catsMap: Record<string, CategoryRow> = {};
        if (catIds.length) {
          const { data: cats, error: catErr } = await supabase
            .from("categories")
            .select("id,name,slug")
            .in("id", catIds);

          if (catErr) throw catErr;

          for (const c of (cats as CategoryRow[]) || []) {
            catsMap[c.id] = c;
          }
        }
        setCatById(catsMap);
      } catch (e: any) {
        setError(e?.message || "Failed to load invoices");
        setInvoices([]);
        setAreaById({});
        setCatById({});
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Industries available for THIS business (based on invoices -> area -> category)
  const industries = useMemo(() => {
    const set = new Map<string, string>(); // catId -> name
    for (const inv of invoices) {
      if (!inv.area_id) continue;
      const area = areaById[inv.area_id];
      const catId = area?.category_id;
      if (!catId) continue;
      const name = catById[catId]?.name || "Unknown industry";
      set.set(catId, name);
    }
    return Array.from(set.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [invoices, areaById, catById]);

  // Month options (issued date = billing_period_start if present else created_at)
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const inv of invoices) {
      const base = inv.billing_period_start || inv.created_at;
      set.add(monthKeyFromISO(base));
    }
    return Array.from(set).sort((a, b) => (a > b ? -1 : 1)); // newest first
  }, [invoices]);

  // Filtered list
  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      // industry filter
      if (industryId !== "all") {
        const area = inv.area_id ? areaById[inv.area_id] : null;
        if (!area?.category_id || area.category_id !== industryId) return false;
      }

      // month filter
      if (month !== "all") {
        const base = inv.billing_period_start || inv.created_at;
        const mk = monthKeyFromISO(base);
        if (mk !== month) return false;
      }

      return true;
    });
  }, [invoices, areaById, industryId, month]);

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="section-title text-2xl">Invoices</h1>
        <Link to="/dashboard" className="btn">
          Back to dashboard
        </Link>
      </div>

      {/* Filters (always visible) */}
      <div className="card mb-6">
        <div className="card-pad grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-4 items-end">
          <div>
            <label className="muted text-sm">Sort by industry</label>
            <select
              className="input w-full"
              value={industryId}
              onChange={(e) => setIndustryId(e.target.value)}
              disabled={loading || industries.length === 0}
            >
              <option value="all">All industries</option>
              {industries.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="muted text-sm">Month issued</label>
            <select
              className="input w-full"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              disabled={loading || months.length === 0}
            >
              <option value="all">All months</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn"
            onClick={() => {
              setIndustryId("all");
              setMonth("all");
            }}
            disabled={loading}
          >
            Clear
          </button>
        </div>
      </div>

      {loading && <div className="muted">Loading invoices…</div>}

      {error && <div className="alert alert-error mb-4">{error}</div>}

      {!loading && !error && (
        <div className="muted mb-3">
          Showing {filtered.length} of {invoices.length} invoices
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="muted">No invoices found for those filters.</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Industry</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Issued</th>
                  <th className="text-right">PDF</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const pdf = inv.pdf_signed_url || inv.pdf_url || null;
                  const area = inv.area_id ? areaById[inv.area_id] : null;
                  const catId = area?.category_id || null;
                  const industryName = catId ? (catById[catId]?.name || "Unknown industry") : "—";
                  const issuedBase = inv.billing_period_start || inv.created_at;

                  return (
                    <tr key={inv.id}>
                      <td>{inv.invoice_number || inv.stripe_invoice_id || "—"}</td>
                      <td>{industryName}</td>
                      <td className="capitalize">{inv.status || "—"}</td>
                      <td>{money(inv.total_cents, inv.currency)}</td>
                      <td>{new Date(issuedBase).toLocaleDateString()}</td>
                      <td className="text-right">
                        {pdf ? (
                          <a className="btn btn-sm" href={pdf} target="_blank" rel="noreferrer">
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
              “Issued” uses billing_period_start if present, otherwise created_at.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
