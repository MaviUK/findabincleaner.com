// src/pages/Invoices.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

type ServiceAreaRow = {
  id: string;
  name: string;
  category_id: string | null;
};

type CategoryRow = {
  id: string;
  name: string;
};

type SponsoredSubscriptionRow = {
  id: string;
  cleaner_id: string;
  area_id: string | null;
  category_id: string | null;
};

type SponsoredInvoiceRow = {
  id: string;
  sponsored_subscription_id: string | null;

  stripe_invoice_id: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;

  amount_due_pennies: number | null;
  currency: string | null;
  status: string | null;

  period_start: string | null; // timestamp
  period_end: string | null; // timestamp
  created_at: string;
  updated_at: string | null;
};

type UiInvoice = SponsoredInvoiceRow & {
  area_id: string | null;
  area_name: string | null;

  category_id: string | null;
  category_name: string | null;

  month_key: string; // YYYY-MM
};

function formatMoney(pennies: number | null | undefined, currency: string | null | undefined) {
  const c = Number(pennies ?? 0);
  const cur = (currency || "GBP").toUpperCase();
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: cur,
    }).format(c / 100);
  } catch {
    return `£${(c / 100).toFixed(2)}`;
  }
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateOnly(isoOrDate: string | null | undefined) {
  if (!isoOrDate) return "—";
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function monthKeyFrom(dateIsoOrDate: string | null | undefined) {
  if (!dateIsoOrDate) return "unknown";
  const d = new Date(dateIsoOrDate);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabel(key: string) {
  if (!key || key === "unknown") return "Unknown";
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export default function Invoices() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [cleanerId, setCleanerId] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<UiInvoice[]>([]);
  const [areas, setAreas] = useState<ServiceAreaRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const [industryFilter, setIndustryFilter] = useState<string>("all"); // category_id
  const [monthFilter, setMonthFilter] = useState<string>("all"); // YYYY-MM

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);

      try {
        // 1) who is logged in?
        const { data: sess } = await supabase.auth.getSession();
        const userId = sess?.session?.user?.id;
        if (!userId) {
          setCleanerId(null);
          setInvoices([]);
          setAreas([]);
          setCategories([]);
          setLoading(false);
          return;
        }

        // 2) map user -> cleaner id
        const { data: cleaner, error: cErr } = await supabase
          .from("cleaners")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();

        if (cErr) throw cErr;
        if (!cleaner?.id) throw new Error("Cleaner not found");

        const cid = String(cleaner.id);
        setCleanerId(cid);

        // 3) load sponsored subscriptions for this cleaner
        // (we need these to know which invoices belong to the cleaner,
        // because sponsored_invoices DOES NOT contain cleaner_id)
        const { data: subRows, error: subErr } = await supabase
          .from("sponsored_subscriptions")
          .select("id,cleaner_id,area_id,category_id")
          .eq("cleaner_id", cid);

        if (subErr) throw subErr;

        const subs: SponsoredSubscriptionRow[] = (subRows || []).map((r: any) => ({
          id: String(r.id),
          cleaner_id: String(r.cleaner_id),
          area_id: r.area_id ? String(r.area_id) : null,
          category_id: r.category_id ? String(r.category_id) : null,
        }));

        const subIds = subs.map((s) => s.id).filter(Boolean);
        const subById = new Map<string, SponsoredSubscriptionRow>(subs.map((s) => [s.id, s]));

        // If no subs, then no invoices for this cleaner
        if (subIds.length === 0) {
          setInvoices([]);
          setAreas([]);
          setCategories([]);
          setLoading(false);
          return;
        }

        // 4) load invoices by sponsored_subscription_id IN (subIds)
        const { data: invRows, error: invErr } = await supabase
          .from("sponsored_invoices")
          .select(
            [
              "id",
              "sponsored_subscription_id",
              "stripe_invoice_id",
              "hosted_invoice_url",
              "invoice_pdf",
              "amount_due_pennies",
              "currency",
              "status",
              "period_start",
              "period_end",
              "created_at",
              "updated_at",
            ].join(",")
          )
          .in("sponsored_subscription_id", subIds)
          .order("created_at", { ascending: false });

        if (invErr) throw invErr;

        const safeInv: SponsoredInvoiceRow[] = (invRows || []).map((r: any) => ({
          id: String(r.id),
          sponsored_subscription_id: r.sponsored_subscription_id ? String(r.sponsored_subscription_id) : null,
          stripe_invoice_id: r.stripe_invoice_id ? String(r.stripe_invoice_id) : null,
          hosted_invoice_url: r.hosted_invoice_url ? String(r.hosted_invoice_url) : null,
          invoice_pdf: r.invoice_pdf ? String(r.invoice_pdf) : null,
          amount_due_pennies: r.amount_due_pennies != null ? Number(r.amount_due_pennies) : null,
          currency: r.currency ? String(r.currency) : null,
          status: r.status ? String(r.status) : null,
          period_start: r.period_start ? String(r.period_start) : null,
          period_end: r.period_end ? String(r.period_end) : null,
          created_at: String(r.created_at),
          updated_at: r.updated_at ? String(r.updated_at) : null,
        }));

        // 5) load service areas for area names
        const { data: areaRows, error: aErr } = await supabase
          .from("service_areas")
          .select("id,name,category_id")
          .eq("cleaner_id", cid);

        if (aErr) throw aErr;

        const safeAreas: ServiceAreaRow[] = (areaRows || []).map((a: any) => ({
          id: String(a.id),
          name: String(a.name),
          category_id: a.category_id ? String(a.category_id) : null,
        }));

        // 6) categories list for names (optional RPC)
        let catRows: CategoryRow[] = [];
        const { data: cats, error: catErr } = await supabase.rpc("list_active_categories_for_cleaner", {
          _cleaner_id: cid,
        });
        if (!catErr && cats) {
          catRows = (Array.isArray(cats) ? cats : []).map((r: any) => ({
            id: String(r.id),
            name: String(r.name),
          }));
        }

        const areaById = new Map<string, ServiceAreaRow>(safeAreas.map((a) => [a.id, a]));
        const catNameById = new Map<string, string>(catRows.map((c) => [c.id, c.name]));

        // 7) build UI rows: invoice -> subscription -> area/category
        const ui: UiInvoice[] = safeInv.map((inv) => {
          const sub = inv.sponsored_subscription_id ? subById.get(inv.sponsored_subscription_id) : null;
          const area_id = sub?.area_id ?? null;
          const category_id = sub?.category_id ?? null;

          const area = area_id ? areaById.get(area_id) : null;
          const resolvedCategoryId = (category_id ?? area?.category_id ?? null) || null;

          return {
            ...inv,
            area_id,
            area_name: area?.name ?? null,
            category_id: resolvedCategoryId,
            category_name: resolvedCategoryId ? catNameById.get(resolvedCategoryId) ?? null : null,
            month_key: monthKeyFrom(inv.created_at),
          };
        });

        setAreas(safeAreas);
        setCategories(catRows);
        setInvoices(ui);
      } catch (e: any) {
        setErr(e?.message || "Failed to load invoices");
        setInvoices([]);
        setAreas([]);
        setCategories([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Dropdown options: industries this business is in (from service_areas.category_id)
  const industryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of areas) {
      if (a.category_id) set.add(a.category_id);
    }
    const ids = Array.from(set);

    const nameById = new Map(categories.map((c) => [c.id, c.name]));
    return ids
      .map((id) => ({
        id,
        name: nameById.get(id) || "Industry",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [areas, categories]);

  // Dropdown options: months present (from invoice created_at)
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const inv of invoices) set.add(inv.month_key);
    const keys = Array.from(set).filter(Boolean);
    keys.sort((a, b) => b.localeCompare(a)); // newest first
    return keys.map((k) => ({ key: k, label: monthLabel(k) }));
  }, [invoices]);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (industryFilter !== "all") {
        if (inv.category_id !== industryFilter) return false;
      }
      if (monthFilter !== "all") {
        if (inv.month_key !== monthFilter) return false;
      }
      return true;
    });
  }, [invoices, industryFilter, monthFilter]);

  const clearFilters = () => {
    setIndustryFilter("all");
    setMonthFilter("all");
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-10">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="section-title text-2xl mb-1">Invoices</h1>
          <p className="muted">Your invoice history ({filtered.length})</p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/dashboard" className="btn">
            Back to dashboard
          </Link>
        </div>
      </div>

      <section className="card">
        <div className="card-pad">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
            <div>
              <label className="text-sm font-medium block mb-1">Sort by industry</label>
              <select
                className="input w-full"
                value={industryFilter}
                onChange={(e) => setIndustryFilter(e.target.value)}
                disabled={loading}
              >
                <option value="all">All industries</option>
                {industryOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">Month issued</label>
              <select
                className="input w-full"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                disabled={loading}
              >
                <option value="all">All months</option>
                {monthOptions.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <button className="btn" onClick={clearFilters} disabled={loading}>
              Clear
            </button>
          </div>

          {err ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3">
              {err}
            </div>
          ) : null}

          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-ink-100">
                  <th className="py-3 pr-4">Invoice</th>
                  <th className="py-3 pr-4">Industry</th>
                  <th className="py-3 pr-4">Area</th>
                  <th className="py-3 pr-4">Period start</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Total</th>
                  <th className="py-3 pr-4">Created</th>
                  <th className="py-3">Download</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-6 muted">
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 muted">
                      No invoices found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((inv) => {
                    const label = inv.stripe_invoice_id || inv.id;
                    const industry = inv.category_name || "—";
                    const area = inv.area_name || "—";

                    // ✅ only start date (as requested)
                    const periodStart = formatDateOnly(inv.period_start);
                    const created = formatDateTime(inv.created_at);

                    const status =
                      inv.status
                        ? inv.status.charAt(0).toUpperCase() + inv.status.slice(1)
                        : "—";

                    const total = formatMoney(inv.amount_due_pennies, inv.currency);

                    // Prefer invoice_pdf for download (PDF), else hosted invoice URL
                    const pdfHref = inv.invoice_pdf || inv.hosted_invoice_url || "";

                    return (
                      <tr key={inv.id} className="border-b border-ink-50">
                        <td className="py-3 pr-4 font-medium whitespace-nowrap">{label}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">{industry}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">{area}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">{periodStart}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">{status}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">{total}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">{created}</td>
                        <td className="py-3 whitespace-nowrap">
                          {pdfHref ? (
                            <a className="link" href={pdfHref} target="_blank" rel="noreferrer">
                              PDF
                            </a>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            <p className="muted text-xs mt-3">
              If “PDF” is blank, that invoice row doesn’t have a stored PDF URL yet.
            </p>

            {cleanerId ? <p className="muted text-xs mt-2">Cleaner: {cleanerId}</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
