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

type SponsoredInvoiceRow = {
  id: string;

  // owner columns (one of these will exist depending on your schema)
  cleaner_id?: string | null;
  business_id?: string | null;

  area_id: string | null;

  stripe_invoice_id: string | null;
  stripe_payment_intent_id: string | null;

  invoice_number: string | null;
  status: string | null;

  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  currency: string | null;

  billing_period_start: string | null; // date
  billing_period_end: string | null; // date (not displayed)
  created_at: string;

  pdf_url: string | null;
  pdf_signed_url: string | null;

  // optional if you sometimes store it on invoice rows
  category_id?: string | null;
};

type UiInvoice = SponsoredInvoiceRow & {
  area_name: string | null;
  category_id_norm: string | null; // used for filters
  category_name: string | null;
  month_key: string; // YYYY-MM
};

function formatMoney(
  cents: number | null | undefined,
  currency: string | null | undefined
) {
  const c = Number(cents ?? 0);
  const cur = (currency || "GBP").toUpperCase();
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format(c / 100);
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

async function fetchCategoriesForOwner(ownerId: string): Promise<CategoryRow[]> {
  // Try your RPC first (best)
  {
    const { data, error } = await supabase.rpc("list_active_categories_for_cleaner", {
      _cleaner_id: ownerId,
    });
    if (!error && data) {
      const rows = Array.isArray(data) ? data : [];
      return rows
        .map((r: any) => ({ id: String(r.id), name: String(r.name) }))
        .filter((r) => r.id && r.name);
    }
  }

  // Fallback: categories table (if it exists)
  {
    const { data, error } = await supabase.from("categories").select("id,name");
    if (!error && data) {
      return (data as any[]).map((r) => ({ id: String(r.id), name: String(r.name) }));
    }
  }

  return [];
}

function isMissingColumnError(e: any, columnName: string) {
  const msg = String(e?.message || e || "").toLowerCase();
  return msg.includes("does not exist") && msg.includes(columnName.toLowerCase());
}

export default function Invoices() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [ownerId, setOwnerId] = useState<string | null>(null); // your cleaner/business id
  const [ownerLabel, setOwnerLabel] = useState<"cleaner_id" | "business_id">("cleaner_id");

  const [invoices, setInvoices] = useState<UiInvoice[]>([]);
  const [areas, setAreas] = useState<ServiceAreaRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);

      try {
        // 1) session
        const { data: sess } = await supabase.auth.getSession();
        const userId = sess?.session?.user?.id;
        if (!userId) {
          setOwnerId(null);
          setInvoices([]);
          setAreas([]);
          setCategories([]);
          setLoading(false);
          return;
        }

        // 2) map user -> cleaners.id (this is your owner id used throughout UI)
        const { data: cleaner, error: cErr } = await supabase
          .from("cleaners")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();

        if (cErr) throw cErr;
        if (!cleaner?.id) throw new Error("Cleaner not found");

        const oid = String(cleaner.id);
        setOwnerId(oid);

        // 3) invoices: try cleaner_id, fallback to business_id
        let invRows: any[] = [];
        let invOwnerCol: "cleaner_id" | "business_id" = "cleaner_id";

        {
          const attempt = await supabase
            .from("sponsored_invoices")
            .select(
              [
                "id",
                "cleaner_id",
                "business_id",
                "area_id",
                "stripe_invoice_id",
                "stripe_payment_intent_id",
                "invoice_number",
                "status",
                "subtotal_cents",
                "tax_cents",
                "total_cents",
                "currency",
                "billing_period_start",
                "billing_period_end",
                "created_at",
                "pdf_url",
                "pdf_signed_url",
                "category_id",
              ].join(",")
            )
            .eq("cleaner_id", oid)
            .order("created_at", { ascending: false });

          if (!attempt.error) {
            invRows = attempt.data || [];
            invOwnerCol = "cleaner_id";
          } else if (isMissingColumnError(attempt.error, "cleaner_id")) {
            const attempt2 = await supabase
              .from("sponsored_invoices")
              .select(
                [
                  "id",
                  "cleaner_id",
                  "business_id",
                  "area_id",
                  "stripe_invoice_id",
                  "stripe_payment_intent_id",
                  "invoice_number",
                  "status",
                  "subtotal_cents",
                  "tax_cents",
                  "total_cents",
                  "currency",
                  "billing_period_start",
                  "billing_period_end",
                  "created_at",
                  "pdf_url",
                  "pdf_signed_url",
                  "category_id",
                ].join(",")
              )
              .eq("business_id", oid)
              .order("created_at", { ascending: false });

            if (attempt2.error) throw attempt2.error;
            invRows = attempt2.data || [];
            invOwnerCol = "business_id";
          } else {
            throw attempt.error;
          }
        }

        setOwnerLabel(invOwnerCol);

        // 4) service areas: try cleaner_id, fallback to business_id
        let areaRows: any[] = [];
        {
          const attempt = await supabase
            .from("service_areas")
            .select("id,name,category_id")
            .eq("cleaner_id", oid);

          if (!attempt.error) {
            areaRows = attempt.data || [];
          } else if (isMissingColumnError(attempt.error, "cleaner_id")) {
            const attempt2 = await supabase
              .from("service_areas")
              .select("id,name,category_id")
              .eq("business_id", oid);

            if (attempt2.error) throw attempt2.error;
            areaRows = attempt2.data || [];
          } else {
            throw attempt.error;
          }
        }

        // 5) categories (names)
        const catRows = await fetchCategoriesForOwner(oid);

        // normalize data
        const safeInv: SponsoredInvoiceRow[] = (invRows || []).map((r: any) => ({
          id: String(r.id),

          cleaner_id: r.cleaner_id ? String(r.cleaner_id) : null,
          business_id: r.business_id ? String(r.business_id) : null,

          area_id: r.area_id ? String(r.area_id) : null,

          stripe_invoice_id: r.stripe_invoice_id ? String(r.stripe_invoice_id) : null,
          stripe_payment_intent_id: r.stripe_payment_intent_id
            ? String(r.stripe_payment_intent_id)
            : null,

          invoice_number: r.invoice_number ? String(r.invoice_number) : null,
          status: r.status ? String(r.status) : null,

          subtotal_cents: r.subtotal_cents != null ? Number(r.subtotal_cents) : null,
          tax_cents: r.tax_cents != null ? Number(r.tax_cents) : null,
          total_cents: r.total_cents != null ? Number(r.total_cents) : null,
          currency: r.currency ? String(r.currency) : null,

          billing_period_start: r.billing_period_start ? String(r.billing_period_start) : null,
          billing_period_end: r.billing_period_end ? String(r.billing_period_end) : null,
          created_at: String(r.created_at),

          pdf_url: r.pdf_url ? String(r.pdf_url) : null,
          pdf_signed_url: r.pdf_signed_url ? String(r.pdf_signed_url) : null,

          category_id: r.category_id ? String(r.category_id) : null,
        }));

        const safeAreas: ServiceAreaRow[] = (areaRows || []).map((a: any) => ({
          id: String(a.id),
          name: String(a.name),
          category_id: a.category_id ? String(a.category_id) : null,
        }));

        const areaById = new Map<string, ServiceAreaRow>(safeAreas.map((a) => [a.id, a]));
        const catNameById = new Map<string, string>(catRows.map((c) => [c.id, c.name]));

        const ui: UiInvoice[] = safeInv.map((inv) => {
          const area = inv.area_id ? areaById.get(inv.area_id) : null;
          const categoryIdNorm = (inv.category_id ?? area?.category_id ?? null) || null;

          return {
            ...inv,
            area_name: area?.name ?? null,
            category_id_norm: categoryIdNorm,
            category_name: categoryIdNorm ? catNameById.get(categoryIdNorm) ?? null : null,
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

  const industryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of areas) {
      if (a.category_id) set.add(a.category_id);
    }
    const ids = Array.from(set);
    const nameById = new Map(categories.map((c) => [c.id, c.name]));

    return ids
      .map((id) => ({ id, name: nameById.get(id) || "Industry" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [areas, categories]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const inv of invoices) set.add(inv.month_key);
    const keys = Array.from(set).filter(Boolean);
    keys.sort((a, b) => b.localeCompare(a));
    return keys.map((k) => ({ key: k, label: monthLabel(k) }));
  }, [invoices]);

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (industryFilter !== "all" && inv.category_id_norm !== industryFilter) return false;
      if (monthFilter !== "all" && inv.month_key !== monthFilter) return false;
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
                    const label = inv.invoice_number || inv.stripe_invoice_id || inv.id;
                    const industry = inv.category_name || "—";
                    const area = inv.area_name || "—";

                    // Only start date (your request)
                    const periodStart = formatDateOnly(inv.billing_period_start || inv.created_at);
                    const created = formatDateTime(inv.created_at);

                    const status =
                      inv.status
                        ? inv.status.charAt(0).toUpperCase() + inv.status.slice(1)
                        : "—";

                    const total = formatMoney(inv.total_cents, inv.currency);

                    const pdfHref = inv.pdf_signed_url || inv.pdf_url || "";

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

            {ownerId ? (
              <p className="muted text-xs mt-2">
                Cleaner: {ownerId} (queried via sponsored_invoices.{ownerLabel})
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
